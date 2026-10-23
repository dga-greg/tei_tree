import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request } from 'express';
import busboy from 'busboy';
import { fileTypeFromFile } from 'file-type';
import sharp from 'sharp';
import { MEDIA_ACCEPT, type MediaKind } from '@fh/contracts';
import { AppError } from '../../core/errors.js';

export interface ReceivedUpload {
  fields: Record<string, string>;
  file: { path: string; originalName: string; size: number; sha256: string };
  /** Removes the temporary directory. Always call it. */
  cleanup(): Promise<void>;
}

/**
 * Streams a multipart upload to a private temporary file while hashing it. Exactly one file part
 * (`file`) is accepted; the size limit is enforced while streaming, so oversized uploads never fill the disk.
 */
export async function receiveUpload(req: Request, maxBytes: number, options: { fieldSize?: number } = {}): Promise<ReceivedUpload> {
  let parser: busboy.Busboy;
  try {
    parser = busboy({ headers: req.headers, limits: { files: 1, fileSize: maxBytes, fields: 20, fieldSize: options.fieldSize ?? 20_000, parts: 25 }, defParamCharset: 'utf8' });
  } catch {
    throw new AppError('VALIDATION_FAILED', 'Send the file as multipart/form-data', [{ path: 'file', message: 'Expected a file upload' }]);
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fh-upload-'));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  const fields: Record<string, string> = {};
  let file: ReceivedUpload['file'] | null = null;
  let tooLarge = false;
  let writing: Promise<void> | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      parser.on('field', (name, value) => {
        fields[name] = value;
      });
      parser.on('file', (name, stream, info) => {
        if (name !== 'file' || writing) {
          stream.resume();
          return;
        }
        const target = path.join(dir, 'upload');
        const hash = createHash('sha256');
        const hasher = new Transform({
          transform(chunk: Buffer, _enc, done) {
            hash.update(chunk);
            done(null, chunk);
          },
        });
        stream.on('limit', () => {
          tooLarge = true;
        });
        writing = pipeline(stream, hasher, createWriteStream(target, { mode: 0o600 })).then(async () => {
          file = { path: target, originalName: info.filename || 'upload', size: (await stat(target)).size, sha256: hash.digest('hex') };
        });
        writing.catch(reject);
      });
      parser.on('error', reject);
      parser.on('close', () => {
        (writing ?? Promise.resolve()).then(() => resolve(), reject);
      });
      req.pipe(parser);
    });
  } catch (err) {
    await cleanup();
    if (err instanceof AppError) throw err;
    throw new AppError('VALIDATION_FAILED', 'The upload could not be read', [{ path: 'file', message: 'The upload was interrupted or malformed' }]);
  }

  if (tooLarge) {
    await cleanup();
    throw new AppError('PAYLOAD_TOO_LARGE', `Files may be at most ${Math.round(maxBytes / 1024 / 1024)} MB`, [{ path: 'file', message: 'File too large' }]);
  }
  if (!file || (file as ReceivedUpload['file']).size === 0) {
    await cleanup();
    throw new AppError('VALIDATION_FAILED', 'Choose a file to upload', [{ path: 'file', message: 'Required' }]);
  }
  return { fields, file, cleanup };
}

const KIND_BY_MIME = new Map<string, MediaKind>(
  (Object.entries(MEDIA_ACCEPT) as [MediaKind, readonly string[]][]).flatMap(([kind, types]) => types.map((t) => [t, kind] as const)),
);

/**
 * Decides what a file is from its content. The browser's MIME type and the file name are ignored:
 * an HTML page named `photo.jpg` is refused, and SVG (which can carry scripts) is not accepted at all.
 */
export async function sniff(filePath: string): Promise<{ kind: MediaKind; mime: string; ext: string }> {
  const detected = await fileTypeFromFile(filePath);
  const kind = detected ? KIND_BY_MIME.get(detected.mime) : undefined;
  if (!detected || !kind) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'This kind of file is not accepted. Upload a photo (JPEG, PNG, WebP, GIF, TIFF), a PDF, an audio recording or a video.', [
      { path: 'file', message: detected ? `Files of type ${detected.mime} are not accepted` : 'Unrecognised file type' },
    ]);
  }
  return { kind, mime: detected.mime, ext: detected.ext };
}

/** Longest side of stored photos; larger originals are scaled down. */
const MAX_PHOTO_SIDE = 4096;
const THUMB_SIDE = 480;
/** Refuses decompression bombs (images whose pixel count would exhaust memory). */
const MAX_INPUT_PIXELS = 120_000_000;

export interface ProcessedImage {
  original: { path: string; mime: string; ext: string; width: number; height: number };
  thumb: { path: string; mime: string };
}

/**
 * Re-encodes a photo. Decoding and re-encoding drops anything that is not pixels — EXIF (including GPS
 * location), XMP, embedded thumbnails and trailing data — and neutralises malformed files. The image is
 * rotated according to its EXIF orientation first, so it still displays the right way up.
 */
export async function processImage(filePath: string, mime: string): Promise<ProcessedImage> {
  const dir = path.dirname(filePath);
  const animated = mime === 'image/gif' || mime === 'image/webp';
  try {
    const input = () => sharp(filePath, { limitInputPixels: MAX_INPUT_PIXELS, animated, failOn: 'error' });
    const resized = () => input().rotate().resize({ width: MAX_PHOTO_SIDE, height: MAX_PHOTO_SIDE, fit: 'inside', withoutEnlargement: true });

    let out: { mime: string; ext: string };
    const target = path.join(dir, 'processed');
    if (mime === 'image/png') {
      out = { mime: 'image/png', ext: 'png' };
      await resized().png({ compressionLevel: 9 }).toFile(target);
    } else if (animated) {
      out = { mime: 'image/webp', ext: 'webp' };
      await resized().webp({ quality: 85 }).toFile(target);
    } else {
      out = { mime: 'image/jpeg', ext: 'jpg' };
      await resized().jpeg({ quality: 88, mozjpeg: true }).toFile(target);
    }
    const meta = await sharp(target, { animated }).metadata();
    const thumbPath = path.join(dir, 'thumb');
    await sharp(target, { limitInputPixels: MAX_INPUT_PIXELS }).resize({ width: THUMB_SIDE, height: THUMB_SIDE, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(thumbPath);
    return {
      original: { path: target, mime: out.mime, ext: out.ext, width: meta.width ?? 0, height: meta.pageHeight ?? meta.height ?? 0 },
      thumb: { path: thumbPath, mime: 'image/webp' },
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'This image could not be read. It may be damaged or too large.', [{ path: 'file', message: 'Unreadable image' }]);
  }
}
