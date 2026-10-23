import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Encrypts small secrets (authenticator keys) at rest with AES-256-GCM, so a copy of the database alone
 * cannot produce sign-in codes. Also keys the hashes of recovery codes.
 */
export class SecretBox {
  private readonly key: Buffer;
  private readonly macKey: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(hkdfSync('sha256', secret, 'family-heritage', 'mfa-encryption', 32));
    this.macKey = Buffer.from(hkdfSync('sha256', secret, 'family-heritage', 'mfa-recovery-codes', 32));
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), body.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
  }

  open(sealed: string): string {
    const [version, iv, body, tag] = sealed.split('.');
    if (version !== 'v1' || !iv || !body || !tag) throw new Error('Unreadable secret');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  }

  /** Keyed hash for recovery codes: without the key, a database copy cannot be searched for them. */
  mac(value: string): string {
    return createHmac('sha256', this.macKey).update(value).digest('hex');
  }
}
