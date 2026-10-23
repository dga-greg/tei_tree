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
import { BranchesController } from './modules/branches/branches.controller.js';
import { TreeService } from './modules/tree/tree.service.js';
import { TreeController } from './modules/tree/tree.controller.js';
import { KinshipService } from './modules/kinship/kinship.service.js';
import { KinshipController } from './modules/kinship/kinship.controller.js';
import { ContributionsService } from './modules/contributions/contributions.service.js';
import { ContributionsController } from './modules/contributions/contributions.controller.js';
import { InvitationsService } from './modules/invitations/invitations.service.js';
import { InvitationsController } from './modules/invitations/invitations.controller.js';
import { MembershipsService } from './modules/families/memberships.service.js';
import { CollaborationController } from './modules/families/collaboration.controller.js';
import { AuditReadService } from './modules/audit/audit.read.js';
import { resolveFamilyAccess } from './modules/families/family-access.js';
import { requireAuth } from './middleware/authenticate.js';
import { fileRateLimit, uploadRateLimit } from './middleware/rate-limit.js';
import { LocalStorage, storageFromEnv, type StorageProvider } from './infra/storage.js';
import { MediaService } from './modules/media/media.service.js';
import { MediaController } from './modules/media/media.controller.js';
import { localFilesRoutes } from './modules/media/files.routes.js';
import { StoriesService } from './modules/stories/stories.service.js';
import { StoriesController } from './modules/stories/stories.controller.js';
import { EventsService } from './modules/events/events.service.js';
import { EventsController } from './modules/events/events.controller.js';
import { ExportService } from './modules/export/export.service.js';
import { ExportController } from './modules/export/export.controller.js';
import { LifecycleService } from './modules/lifecycle/lifecycle.service.js';
import { LifecycleController } from './modules/lifecycle/lifecycle.controller.js';
import { ImportService } from './modules/import/import.service.js';
import { ImportController } from './modules/import/import.controller.js';
import { DuplicatesService } from './modules/duplicates/duplicates.service.js';
import { DuplicatesController } from './modules/duplicates/duplicates.controller.js';
import { ReportsService } from './modules/reports/reports.service.js';
import { ReportsController } from './modules/reports/reports.controller.js';
import { Router } from 'express';
import { CalendarService } from './modules/calendar/calendar.service.js';
import { LineageService } from './modules/lineage/lineage.service.js';
import { LineageController } from './modules/lineage/lineage.controller.js';
import { FinanceService } from './modules/finance/finance.service.js';
import { FinanceController } from './modules/finance/finance.controller.js';
import { PlacesService } from './modules/places/places.service.js';
import { PlacesController } from './modules/places/places.controller.js';
import { NotificationsService } from './modules/notifications/notifications.service.js';
import { NotificationsController } from './modules/notifications/notifications.controller.js';
import { pushSenderFromEnv, type PushSender } from './infra/push.js';
import { transcriberFromEnv, type Transcriber } from './infra/transcriber.js';
import { TranscriptionService } from './modules/media/transcription.service.js';
import { BookService } from './modules/book/book.service.js';
import { BookController } from './modules/book/book.controller.js';
import { AnnouncementsService } from './modules/announcements/announcements.service.js';
import { AnnouncementsController } from './modules/announcements/announcements.controller.js';
import { messagingFromEnv, type SmsSender, type WhatsAppSender } from './infra/messaging.js';
import { webRoutes } from './infra/web.js';

export interface AppDependencies {
  env: Env;
  logger: Logger;
  mailer: Mailer;
  redis?: Redis;
  /** Defaults to the provider configured by STORAGE_DRIVER. */
  storage?: StorageProvider;
  /** Defaults to Web Push with the configured VAPID keys (or disabled without them). */
  push?: PushSender;
  /** Defaults to the speech-to-text service configured by TRANSCRIPTION_URL (or none). */
  transcriber?: Transcriber;
  google?: GoogleIdentity;
  /** Defaults to GiantSMS / WhatsApp as configured (or none). */
  messaging?: { sms: SmsSender | null; whatsapp: WhatsAppSender | null };
}

export interface AppInstance {
  app: Express;
  /** Account/family deletion and the purge job (the server schedules the purge when there is no worker). */
  lifecycle: LifecycleService;
  /** Reminders (the server runs them hourly when there is no worker). */
  notifications: NotificationsService;
  /** Automatic transcripts (tests wait for inline runs with `idle()`). */
  transcription: TranscriptionService;
  books: BookService;
  /** Ceremony announcements (the server sends held ones and reminders when there is no worker). */
  announcements: AnnouncementsService;
  close(): Promise<void>;
}

/** Builds the Express application. Does not listen or connect to databases (see server.ts). */
export function createApp({ env, logger, mailer, redis, storage = storageFromEnv(env), push = pushSenderFromEnv(env, logger), transcriber = transcriberFromEnv(env, logger), google = googleFromEnv(env), messaging = messagingFromEnv(env, logger) }: AppDependencies): AppInstance {
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
  const contributionsService = new ContributionsService(membersService, relationshipsService, branchesService, audit, emailDispatcher, env.APP_ORIGIN);
  const invitationsService = new InvitationsService(env.APP_ORIGIN, emailDispatcher, audit);
  invitationsService.attachClaims({
    fileClaim: async (familyId, userId, memberId, note, requestId) => {
      const access = await resolveFamilyAccess(familyId, userId);
      return access ? contributionsService.fileClaim(access, { userId, requestId, ip: null }, memberId, note) : null;
    },
  });
  const invitationsController = new InvitationsController(invitationsService);
  const mediaService = new MediaService(storage, audit, env.MEDIA_MAX_UPLOAD_MB * 1024 * 1024);
  const transcription = new TranscriptionService(storage, transcriber, audit, logger, redis);
  mediaService.attachTranscription(transcription);
  const books = new BookService(storage, audit, logger, redis);
  const storiesService = new StoriesService(mediaService, audit);
  const eventsService = new EventsService(mediaService, audit);
  mediaService.attachReview(contributionsService);
  mediaService.attachProfiles(membersService);
  storiesService.attachReview(contributionsService);
  contributionsService.attachArchive({ media: mediaService, stories: storiesService });
  const lifecycle = new LifecycleService({ familyGraceDays: env.FAMILY_DELETION_GRACE_DAYS, mediaRetentionDays: env.MEDIA_RETENTION_DAYS }, hasher, storage, audit, logger, mfa);
  const lifecycleController = new LifecycleController(lifecycle, cookies);
  const exportController = new ExportController(new ExportService(audit));
  const calendarService = new CalendarService();
  const notifications = new NotificationsService(calendarService, emailDispatcher, push, env.APP_ORIGIN, logger, env.REMINDER_HOUR);
  const notificationsController = new NotificationsController(notifications, calendarService);
  const announcements = new AnnouncementsService(
    { appOrigin: env.APP_ORIGIN, secret: env.CSRF_SECRET, smsPricePesewas: env.SMS_PRICE_PESEWAS, smsMonthlyLimit: env.SMS_MONTHLY_LIMIT_PER_FAMILY, timezone: env.MESSAGING_TIMEZONE, quietHours: env.MESSAGING_QUIET_HOURS },
    messaging,
    emailDispatcher,
    notifications,
    branchesService,
    audit,
    logger,
    redis,
  );
  const announcementsController = new AnnouncementsController(announcements);
  api.use(
    '/families',
    familiesRoutes(
      new FamiliesController(familiesService),
      new MembersController(membersService),
      new RelationshipsController(relationshipsService),
      new GenerationsController(new GenerationsReadService((access) => contributionsService.openCount(access)), generationScheduler, membersService),
      new TreeController(new TreeService(branchesService)),
      new BranchesController(branchesService),
      new KinshipController(new KinshipService()),
      new ContributionsController(contributionsService),
      invitationsController,
      new CollaborationController(new MembershipsService(audit), new AuditReadService(membersService, relationshipsService), membersService),
      {
        media: new MediaController(mediaService),
        stories: new StoriesController(storiesService),
        events: new EventsController(eventsService),
        uploadLimiter: uploadRateLimit(Math.max(100, env.RATE_LIMIT_AUTH_PER_15_MINUTES), redis),
        exports: exportController,
        lifecycle: lifecycleController,
        imports: new ImportController(new ImportService(audit, familiesService, generationScheduler)),
        duplicates: new DuplicatesController(new DuplicatesService(audit, familiesService, generationScheduler)),
        notifications: notificationsController,
        lineage: new LineageController(new LineageService()),
        finance: new FinanceController(new FinanceService(audit, branchesService)),
        places: new PlacesController(new PlacesService(audit)),
        books: new BookController(books),
        announcements: announcementsController,
      },
    ),
  );
  // Invitation links work before the invitee belongs to the family.
  const invitationRoutes = Router();
  invitationRoutes.post('/preview', credentialLimiter, invitationsController.preview);
  invitationRoutes.post('/accept', requireAuth, credentialLimiter, invitationsController.accept);
  invitationRoutes.get('/mine', requireAuth, invitationsController.mine);
  invitationRoutes.post('/:invitationId/accept', requireAuth, credentialLimiter, invitationsController.acceptMine);
  api.use('/invitations', invitationRoutes);
  // Personal links in ceremony announcements: answered without signing in.
  api.post('/rsvp/view', credentialLimiter, announcementsController.rsvpView);
  api.post('/rsvp/answer', credentialLimiter, announcementsController.rsvpAnswer);
  // The signed-in person's own data: download everything, or delete the account.
  const accountRoutes = Router();
  accountRoutes.get('/export', requireAuth, credentialLimiter, exportController.personal);
  accountRoutes.post('/delete', requireAuth, credentialLimiter, lifecycleController.deleteAccount);
  api.use('/account', accountRoutes);
  // Reminders: preferences, devices for phone notifications, the weekly e-mail.
  const notificationRoutes = Router();
  notificationRoutes.use(requireAuth);
  notificationRoutes.get('/preferences', notificationsController.preferences);
  notificationRoutes.put('/preferences', notificationsController.setPreferences);
  notificationRoutes.get('/push', notificationsController.pushStatus);
  notificationRoutes.post('/push/subscriptions', credentialLimiter, notificationsController.subscribe);
  notificationRoutes.post('/push/unsubscribe', notificationsController.unsubscribe);
  notificationRoutes.post('/push/test', credentialLimiter, notificationsController.test);
  notificationRoutes.get('/digest/preview', notificationsController.digestPreview);
  api.use('/notifications', notificationRoutes);
  // What the app may offer: a base map for places, automatic transcripts. Public, holds no secrets.
  api.get('/config', (_req, res) => {
    res.json({
      data: {
        mapTiles: env.MAP_TILE_URL ? { url: env.MAP_TILE_URL, attribution: env.MAP_TILE_ATTRIBUTION, maxZoom: env.MAP_TILE_MAX_ZOOM } : null,
        transcription: transcriber.enabled,
        google: google.enabled,
      },
    });
  });
  const adminService = new AdminService(audit, authService);
  const reportsController = new ReportsController(new ReportsService(adminService, emailDispatcher, audit, env.APP_ORIGIN));
  // Anyone signed in can report content they can see; platform administrators review reports.
  api.post('/reports', requireAuth, credentialLimiter, reportsController.create);
  const adminMfaGate: express.RequestHandler = (req, _res, next) => {
    const user = req.auth?.user;
    if (user && mfa.required(user) && !user.mfa?.enabledAt) return next(new AppError('MFA_REQUIRED', 'Turn on two-step sign-in in Settings → Security to use the administration pages.'));
    next();
  };
  api.use('/admin', adminRoutes(new AdminController(adminService), reportsController, adminMfaGate));
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
    lifecycle,
    notifications,
    transcription,
    books,
    announcements,
    close: async () => {
      await books.close();
      await announcements.close();
      await transcription.idle();
      await transcription.close();
      await emailDispatcher.close();
      await generationScheduler.close();
    },
  };
}
