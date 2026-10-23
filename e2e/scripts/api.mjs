/**
 * Starts everything the API needs for the end-to-end run: a throwaway single-node MongoDB replica set
 * (or E2E_MONGODB_URI), a platform administrator, and the API itself on E2E_API_PORT.
 * E-mails are written to the log file E2E_MAIL_LOG, where the tests read links from.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const output = join(root, 'e2e', '.output');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

let replSet = null;
let uri = process.env.E2E_MONGODB_URI;
if (!uri) {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  uri = replSet.getUri();
}
const db = new URL(uri);
db.pathname = `/fh_e2e_${Date.now()}`;

const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: process.env.E2E_API_PORT ?? '3100',
  APP_ORIGIN: process.env.E2E_WEB_ORIGIN ?? 'http://localhost:4300',
  MONGODB_URI: db.toString(),
  SMTP_URL: '',
  JWT_ACCESS_SECRET: 'e2e-access-secret-that-is-at-least-32-chars',
  CSRF_SECRET: 'e2e-csrf-secret-that-is-at-least-32-characters',
  COOKIE_SECURE: 'false',
  ARGON2_MEMORY_KIB: '4096',
  ARGON2_TIME_COST: '1',
  RATE_LIMIT_AUTH_PER_15_MINUTES: '2000',
  RATE_LIMIT_GLOBAL_PER_MINUTE: '20000',
  MEDIA_LOCAL_DIR: join(output, 'media'),
  LOG_LEVEL: 'info',
  // The reports journey signs in as the platform administrator without an authenticator app.
  ADMIN_MFA_REQUIRED: 'false',
  // Ceremony announcements: SMS and WhatsApp are written to the log (read by the tests), at any hour.
  SMS_PROVIDER: 'log',
  MESSAGING_QUIET_HOURS: 'false',
};
const tsx = join(root, 'node_modules', '.bin', 'tsx');

const admin = spawnSync(tsx, [join(root, 'backend/src/scripts/create-super-admin.ts'), '--email', 'root@e2e.test', '--name', 'Platform Admin'], {
  env: { ...env, SUPER_ADMIN_PASSWORD: 'e2e platform password' },
  stdio: 'inherit',
});
if (admin.status !== 0) process.exit(admin.status ?? 1);

const log = createWriteStream(process.env.E2E_MAIL_LOG ?? join(output, 'api.log'));
const api = spawn(tsx, [join(root, 'backend/src/server.ts')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
api.stdout.pipe(log);
api.stderr.pipe(process.stderr);
api.stdout.on('data', (chunk) => {
  if (String(chunk).includes('API listening')) console.log(`E2E API listening on ${env.PORT}`);
});

const stop = async () => {
  api.kill('SIGTERM');
  await replSet?.stop();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
api.on('exit', async (code) => {
  await replSet?.stop();
  process.exit(code ?? 1);
});
