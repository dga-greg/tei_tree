import { createDecipheriv, createECDH, createHmac, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import webpush from 'web-push';
import { createLogger } from '../src/core/logger.js';
import { WebPushSender } from '../src/infra/push.js';

/**
 * Plays the part of a browser's push service: receives what the server sends, checks the VAPID
 * authorisation and decrypts the message as the browser would (RFC 8291, aes128gcm).
 */
const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();
const expand = (prk: Buffer, info: Buffer, length: number) => hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, length);

function decrypt(body: Buffer, ua: ReturnType<typeof createECDH>, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLength = body[20]!;
  const serverPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const shared = ua.computeSecret(serverPublic);
  const ikm = expand(hmac(authSecret, shared), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), serverPublic]), 32);
  const prk = hmac(salt, ikm);
  const key = expand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = expand(prk, Buffer.from('Content-Encoding: nonce\0'), 12);
  const decipher = createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  // Padding: the last record ends with the delimiter 0x02 followed by zeros.
  return plain.subarray(0, plain.lastIndexOf(2)).toString('utf8');
}

let server: https.Server;
let base = '';
const received: { path: string; headers: Record<string, string | string[] | undefined>; body: Buffer }[] = [];

beforeAll(async () => {
  // A throwaway certificate for the local stand-in push service.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fh-push-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-keyout', `${dir}/key.pem`, '-out', `${dir}/cert.pem`], { stdio: 'ignore' });
  server = https.createServer({ key: readFileSync(`${dir}/key.pem`), cert: readFileSync(`${dir}/cert.pem`) }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push({ path: req.url!, headers: req.headers, body: Buffer.concat(chunks) });
      res.statusCode = req.url === '/gone' ? 410 : req.url === '/broken' ? 500 : 201;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('sending phone notifications', () => {
  const vapid = webpush.generateVAPIDKeys();
  const sender = new WebPushSender(vapid.publicKey, vapid.privateKey, 'mailto:admin@example.org', createLogger('silent', false), new https.Agent({ rejectUnauthorized: false }));
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = randomBytes(16);
  const target = (path: string) => ({ endpoint: `${base}${path}`, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } });

  it('encrypts the notification so only the device can read it, signed with the VAPID key', async () => {
    const result = await sender.send(target('/device'), { title: 'Today in the Mensah Family', body: "Kwame Mensah's 76th birthday", url: '/calendar', tag: 'today' });
    expect(result).toEqual({ ok: true, gone: false });
    const req = received.at(-1)!;
    expect(req.headers['content-encoding']).toBe('aes128gcm');
    expect(req.headers['ttl']).toBe(String(12 * 3600));
    expect(req.headers['authorization']).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${vapid.publicKey}$`));
    expect(req.body.toString('latin1')).not.toContain('Kwame');
    // What the device's service worker receives: Angular's notification format, opening the calendar.
    expect(JSON.parse(decrypt(req.body, ua, auth))).toEqual({
      notification: {
        title: 'Today in the Mensah Family',
        body: "Kwame Mensah's 76th birthday",
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        tag: 'today',
        data: { onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: '/calendar' } } },
      },
    });
  });

  it('reports devices that unsubscribed, and survives push service errors', async () => {
    expect(await sender.send(target('/gone'), { title: 't', body: 'b', url: '/' })).toEqual({ ok: false, gone: true });
    expect(await sender.send(target('/broken'), { title: 't', body: 'b', url: '/' })).toEqual({ ok: false, gone: false });
  });
});
