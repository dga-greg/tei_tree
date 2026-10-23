import express, { type Express } from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { pinoHttp } from 'pino-http';
import type { Env } from './config/env.js';
import { redactUrl, type Logger } from './core/logger.js';
import type { Redis } from './infra/redis.js';
import { EmailDispatcher } from './infra/queues.js';
import type { Mailer } from './infra/mailer.js';
import { requestId } from './middleware/request-id.js';
import { CsrfProtection } from './middleware/csrf.js';
import { authenticate } from './middleware/authenticate.js';
import { authRateLimit, globalRateLimit } from './middleware/rate-limit.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import './modules/models.js';
import { AuditService } from './modules/audit/audit.service.js';
import { PasswordHasher } from './modules/auth/password.js';
import { AccessTokenService } from './modules/auth/tokens.js';
import { AuthCookies } from './modules/auth/cookies.js';
import { AuthService } from './modules/auth/auth.service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { MfaService } from './modules/auth/mfa.service.js';
import { SecretBox } from './modules/auth/secret-box.js';
import { googleFromEnv, type GoogleIdentity } from './modules/auth/google.js';
import { GoogleSignInService } from './modules/auth/google.service.js';
import { AppError } from './core/errors.js';
import { createHmac } from 'node:crypto';
import { AdminService } from './modules/admin/admin.service.js';
import { AdminController } from './modules/admin/admin.controller.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { FamiliesService } from './modules/families/families.service.js';
import { FamiliesController } from './modules/families/families.controller.js';
import { familiesRoutes } from './modules/families/families.routes.js';
import { MembersService } from './modules/members/members.service.js';
import { MembersController } from './modules/members/members.controller.js';
import { RelationshipsService } from './modules/relationships/relationships.service.js';
import { RelationshipsController } from './modules/relationships/relationships.controller.js';
import { GenerationsService } from './modules/generations/generations.service.js';
import { GenerationScheduler } from './modules/generations/generation-scheduler.js';
import { GenerationsReadService } from './modules/generations/generations.read.js';
import { GenerationsController } from './modules/generations/generations.controller.js';
import { BranchesService } from './modules/branches/branches.service.js';
import { TreeService } from './modules/tree/tree.service.js';
import { TreeController } from './modules/tree/tree.controller.js';
import { fileRateLimit, uploadRateLimit } from './middleware/rate-limit.js';
import { LocalStorage, storageFromEnv, type StorageProvider } from './infra/storage.js';
import { MediaService } from './modules/media/media.service.js';
import { MediaController } from './modules/media/media.controller.js';
import { localFilesRoutes } from './modules/media/files.routes.js';
import { webRoutes } from './infra/web.js';

export interface AppDependencies {
  env: Env;
  logger: Logger;
  mailer: Mailer;
  redis?: Redis;
  /** Defaults to the provider configured by STORAGE_DRIVER. */
  storage?: StorageProvider;
  google?: GoogleIdentity;
}

export interface AppInstance {
  app: Express;
  close(): Promise<void>;
}

/** Builds the Express application. Does not listen or connect to databases (see server.ts). */
export function createApp({ env, logger, mailer, redis, storage = storageFromEnv(env), google = googleFromEnv(env) }: AppDependencies): AppInstance {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  // ---- services (composition root)
  const hasher = new PasswordHasher({
    memoryCost: env.ARGON2_MEMORY_KIB,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
  });
  const accessTokens = new AccessTokenService(env.JWT_ACCESS_SECRET, env.ACCESS_TOKEN_TTL_SECONDS);
  const cookies = new AuthCookies(env.COOKIE_SECURE);
  const csrf = new CsrfProtection(env.CSRF_SECRET, { secure: env.COOKIE_SECURE, sameSite: 'strict', path: '/' });
  const emailDispatcher = new EmailDispatcher(mailer, logger, redis);
  const audit = new AuditService();
  const mfaKey = env.MFA_ENCRYPTION_KEY ?? createHmac('sha256', env.JWT_ACCESS_SECRET).update('mfa-secrets').digest('hex');
  const mfa = new MfaService({ issuer: env.MFA_ISSUER, adminRequired: env.ADMIN_MFA_REQUIRED }, new SecretBox(mfaKey), hasher, emailDispatcher);
  const authService = new AuthService(
    {
      appOrigin: env.APP_ORIGIN,
      refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      sessionMaxLifetimeDays: env.SESSION_MAX_LIFETIME_DAYS,
      idleTimeoutMinutes: env.IDLE_TIMEOUT_MINUTES,
      loginMaxAttempts: env.LOGIN_MAX_ATTEMPTS,
      loginLockMinutes: env.LOGIN_LOCK_MINUTES,
      passwordResetTtlMinutes: env.PASSWORD_RESET_TTL_MINUTES,
    },
    hasher,
    accessTokens,
    emailDispatcher,
    logger,
    mfa,
  );
  const googleSignIn = new GoogleSignInService(
    google,
    authService,
    emailDispatcher,
    { appOrigin: env.APP_ORIGIN, stateSecret: createHmac('sha256', env.JWT_ACCESS_SECRET).update('google-sign-in').digest('hex') },
    logger,
  );

  // ---- global middleware
  app.use(requestId);
  if (env.NODE_ENV !== 'test') {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => (req as express.Request).id,
        serializers: {
          req: (req: { url?: string }) => {
            req.url = redactUrl(req.url);
            return req;
          },
        },
      }),
    );
  }
  app.use(
    helmet({
      // The API only serves JSON; the SPA's own CSP is set by the web server that hosts it.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use(compression());

  // Health endpoints sit outside /api so load balancers need neither cookies nor CSRF tokens.
  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/health/ready', (_req, res) => {
    const mongoReady = mongoose.connection.readyState === 1;
    const redisReady = redis ? redis.status === 'ready' : true;
    res.status(mongoReady && redisReady ? 200 : 503).json({ mongo: mongoReady, redis: redis ? redisReady : 'disabled' });
  });

  const api = express.Router();
  api.use(globalRateLimit(env.RATE_LIMIT_GLOBAL_PER_MINUTE, redis));
  // Long stories and biographies (up to 100 000 characters of UTF-8) must fit; anything larger is refused.
  api.use(express.json({ limit: '1mb' }));
  api.use(cookieParser());
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(csrf.ensureCookie);
  api.use(csrf.verify);
  api.use(authenticate(accessTokens));

  const credentialLimiter = authRateLimit(env.RATE_LIMIT_AUTH_PER_15_MINUTES, redis);
  api.use('/auth', authRoutes(new AuthController(authService, cookies, csrf, mfa, googleSignIn, env.APP_ORIGIN), credentialLimiter));
  const generationScheduler = new GenerationScheduler(new GenerationsService(logger), logger, redis, env.GENERATION_INLINE_LIMIT);
  const familiesService = new FamiliesService(audit, generationScheduler);
  const branchesService = new BranchesService(audit, generationScheduler);
  const relationshipsService = new RelationshipsService(audit, generationScheduler, branchesService);
  const membersService = new MembersService(relationshipsService, familiesService, audit, generationScheduler, branchesService);
  familiesService.attachMembers(membersService);
  const mediaService = new MediaService(storage, audit, env.MEDIA_MAX_UPLOAD_MB * 1024 * 1024);
  mediaService.attachProfiles(membersService);
  api.use(
    '/families',
    familiesRoutes(
      new FamiliesController(familiesService),
      new MembersController(membersService),
      new RelationshipsController(relationshipsService),
      new GenerationsController(new GenerationsReadService(), generationScheduler, membersService),
      new TreeController(new TreeService(branchesService)),
      { media: new MediaController(mediaService), uploadLimiter: uploadRateLimit(Math.max(100, env.RATE_LIMIT_AUTH_PER_15_MINUTES), redis) },
    ),
  );
  // What the app may offer. Public, holds no secrets.
  api.get('/config', (_req, res) => {
    res.json({ data: { mapTiles: null, transcription: false, google: google.enabled } });
  });
  const adminService = new AdminService(audit, authService);
  const adminMfaGate: express.RequestHandler = (req, _res, next) => {
    const user = req.auth?.user;
    if (user && mfa.required(user) && !user.mfa?.enabledAt) return next(new AppError('MFA_REQUIRED', 'Turn on two-step sign-in in Settings → Security to use the administration pages.'));
    next();
  };
  api.use('/admin', adminRoutes(new AdminController(adminService), adminMfaGate));
  api.use(notFoundHandler);

  // Signed links to locally stored files (development; production serves S3 links directly).
  if (storage instanceof LocalStorage) app.use('/api/v1/files', fileRateLimit(Math.max(1200, env.RATE_LIMIT_GLOBAL_PER_MINUTE * 4), redis), localFilesRoutes(storage));
  app.use('/api/v1', api);
  // The web app itself, when this process also serves it (WEB_DIST_DIR).
  if (env.WEB_DIST_DIR) app.use(webRoutes(env.WEB_DIST_DIR, env));
  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return {
    app,
    close: async () => {
      await emailDispatcher.close();
      await generationScheduler.close();
    },
  };
}
