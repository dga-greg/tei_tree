import { Router, type RequestHandler } from 'express';
import { requireAuth } from '../../middleware/authenticate.js';
import type { AuthController } from './auth.controller.js';

export function authRoutes(controller: AuthController, credentialLimiter: RequestHandler): Router {
  const router = Router();
  router.get('/csrf', controller.csrfToken);
  router.post('/register', credentialLimiter, controller.register);
  router.post('/login', credentialLimiter, controller.login);
  router.post('/refresh', controller.refresh);
  router.post('/logout', controller.logout);
  router.post('/forgot-password', credentialLimiter, controller.forgotPassword);
  router.post('/reset-password', credentialLimiter, controller.resetPassword);

  router.post('/verify-email', credentialLimiter, controller.verifyEmail);
  router.post('/resend-verification', requireAuth, credentialLimiter, controller.resendVerification);

  router.post('/login/mfa', credentialLimiter, controller.verifyMfa);
  router.get('/mfa', requireAuth, controller.mfaStatus);
  router.post('/mfa/totp/setup', requireAuth, credentialLimiter, controller.mfaSetup);
  router.post('/mfa/totp/enable', requireAuth, credentialLimiter, controller.mfaEnable);
  router.post('/mfa/disable', requireAuth, credentialLimiter, controller.mfaDisable);
  router.post('/mfa/recovery-codes', requireAuth, credentialLimiter, controller.recoveryCodes);
  router.get('/google/start', credentialLimiter, controller.googleStart);
  router.get('/google/callback', credentialLimiter, controller.googleCallback);
  router.delete('/google', requireAuth, credentialLimiter, controller.googleUnlink);

  router.get('/me', requireAuth, controller.me);
  router.post('/activity', requireAuth, controller.activity);
  router.patch('/me', requireAuth, controller.updateMe);
  router.post('/change-password', requireAuth, credentialLimiter, controller.changePassword);
  router.get('/sessions', requireAuth, controller.sessions);
  router.delete('/sessions/:sessionId', requireAuth, controller.revokeSession);
  return router;
}
