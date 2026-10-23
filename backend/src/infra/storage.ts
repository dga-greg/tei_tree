import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, copyFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../config/env.js';

export interface SignedUrlOptions {
  contentType: string;
  /** `attachment` makes browsers download instead of display. */
  disposition: 'inline' | 'attachment';
  /** File name offered for downloads. */
  filename: string;
}

/**
 * Object storage for uploaded files. Buckets and directories are never public: files are only reachable
 * through short-lived signed URLs handed out after an authorisation check (docs/01-ARCHITECTURE.md, D15).
 */
export interface StorageProvider {
  /** Stores a local file under `key`. The local file is left in place. */
  putFile(key: string, filePath: string, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  signedUrl(key: string, options: SignedUrlOptions): Promise<string>;
  /** Reads a stored file (server-side processing, e.g. transcription). */
  read(key: string): Promise<Buffer>;
}

/** Quotes a file name for Content-Disposition, with an RFC 5987 UTF-8 variant. */
export function contentDisposition(disposition: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_').slice(0, 150) || 'file';
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename.slice(0, 150))}`;
}

// ------------------------------------------------------------------------------------------------
// Local directory — development and tests. Files are served by the API at /api/v1/files/:token.

interface LocalToken {
  /** storage key */
  k: string;
  /** expiry, epoch seconds */
  e: number;
  t: string;
  d: 'inline' | 'attachment';
  n: string;
}

export class LocalStorage implements StorageProvider {
  private readonly root: string;

  constructor(
    root: string,
    private readonly secret: string,
    private readonly ttlSeconds: number,
    /** URL prefix of the file route. */
    private readonly baseUrl = '/api/v1/files',
  ) {
    this.root = path.resolve(root);
  }

  /** Resolves a key inside the root, refusing anything that would escape it. */
  private pathOf(key: string): string {
    if (!/^[\w./-]+$/.test(key) || key.includes('..')) throw new Error(`Invalid storage key: ${key}`);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error(`Invalid storage key: ${key}`);
    return full;
  }

  async putFile(key: string, filePath: string): Promise<void> {
    const target = this.pathOf(key);
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.part`;
    await copyFile(filePath, tmp);
    await rename(tmp, target);
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.pathOf(key));
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  async signedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const token: LocalToken = { k: key, e: Math.floor(Date.now() / 1000) + this.ttlSeconds, t: options.contentType, d: options.disposition, n: options.filename };
    const payload = Buffer.from(JSON.stringify(token)).toString('base64url');
    return `${this.baseUrl}/${payload}.${this.sign(payload)}`;
  }

  /** Validates a token from a signed URL. Returns null when it is malformed, tampered with or expired. */
  verify(token: string): (LocalToken & { file: string }) | null {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LocalToken;
      if (typeof data.e !== 'number' || data.e < Date.now() / 1000) return null;
      return { ...data, file: this.pathOf(data.k) };
    } catch {
      return null;
    }
  }

  /** Opens a stored file, optionally a byte range of it (for seeking in recordings and videos). */
  async open(file: string, range?: { start: number; end?: number }): Promise<{ size: number; stream: Readable } | null> {
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return null;
    return { size: info.size, stream: createReadStream(file, range ? { start: range.start, end: range.end } : undefined) };
  }
}

// ------------------------------------------------------------------------------------------------
// S3-compatible object storage (AWS S3, Cloudflare R2, MinIO, …).

export class S3Storage implements StorageProvider {
  private readonly client: S3Client;
  /** Signs links for the address browsers use; the same as `client` unless a public endpoint is set. */
  private readonly signer: S3Client;
  private readonly encryption: 'AES256' | 'aws:kms' | undefined;

  constructor(
    private readonly bucket: string,
    private readonly ttlSeconds: number,
    options: { region: string; endpoint?: string; publicEndpoint?: string; forcePathStyle?: boolean; accessKeyId?: string; secretAccessKey?: string; serverSideEncryption?: 'AES256' | 'aws:kms' },
  ) {
    const client = (endpoint?: string) =>
      new S3Client({
        region: options.region,
        endpoint,
        forcePathStyle: options.forcePathStyle,
        credentials: options.accessKeyId && options.secretAccessKey ? { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey } : undefined,
      });
    this.client = client(options.endpoint);
    this.encryption = options.serverSideEncryption;
    this.signer = options.publicEndpoint ? client(options.publicEndpoint) : this.client;
  }

  async putFile(key: string, filePath: string, contentType: string): Promise<void> {
    const size = (await stat(filePath)).size;
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: createReadStream(filePath), ContentLength: size, ContentType: contentType, ...(this.encryption ? { ServerSideEncryption: this.encryption } : {}) }),
    );
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async read(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async signedUrl(key: string, options: SignedUrlOptions): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentType: options.contentType,
      ResponseContentDisposition: contentDisposition(options.disposition, options.filename),
      ResponseCacheControl: 'private, max-age=300',
    });
    return getSignedUrl(this.signer, command, { expiresIn: this.ttlSeconds });
  }
}

export function storageFromEnv(env: Env): StorageProvider {
  if (env.STORAGE_DRIVER === 's3') {
    return new S3Storage(env.S3_BUCKET!, env.MEDIA_URL_TTL_SECONDS, {
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      publicEndpoint: env.S3_PUBLIC_ENDPOINT,
      serverSideEncryption: env.S3_SERVER_SIDE_ENCRYPTION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
  }
  const secret = env.MEDIA_SIGNING_SECRET ?? createHmac('sha256', env.JWT_ACCESS_SECRET).update('media-links').digest('hex');
  return new LocalStorage(env.MEDIA_LOCAL_DIR, secret, env.MEDIA_URL_TTL_SECONDS);
}
