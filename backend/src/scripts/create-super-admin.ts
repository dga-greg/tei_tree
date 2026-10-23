/**
 * Creates (or promotes) a super administrator. Super admins cannot be created through the API.
 *
 *   npm run create-super-admin -- --email admin@example.org --name "Platform Admin"
 *
 * The password is read from the SUPER_ADMIN_PASSWORD environment variable (never from argv, which
 * is visible in process listings). When promoting an existing account the password is not changed.
 */
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../core/logger.js';
import { connectMongo, disconnectMongo } from '../infra/mongo.js';
import { PasswordHasher } from '../modules/auth/password.js';
import { password as passwordSchema } from '../modules/auth/auth.validators.js';
import { UserModel } from '../modules/users/user.model.js';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
  const email = z.email().parse(values.email).toLowerCase();
  const env = loadEnv();
  const logger = createLogger('info', false);
  await connectMongo(env.MONGODB_URI, logger);

  try {
    const existing = await UserModel.findOne({ email });
    if (existing) {
      existing.platformRole = 'super_admin';
      await existing.save();
      logger.info({ email }, 'Existing account promoted to super administrator');
      return;
    }
    const pw = passwordSchema.parse(process.env['SUPER_ADMIN_PASSWORD']);
    const hasher = new PasswordHasher({ memoryCost: env.ARGON2_MEMORY_KIB, timeCost: env.ARGON2_TIME_COST, parallelism: env.ARGON2_PARALLELISM });
    await UserModel.create({
      email,
      displayName: values.name ?? 'Platform Administrator',
      passwordHash: await hasher.hash(pw),
      platformRole: 'super_admin',
      // Created by an operator on the server, so the address is taken as confirmed.
      emailVerifiedAt: new Date(),
    });
    logger.info({ email }, 'Super administrator created');
  } finally {
    await disconnectMongo();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
