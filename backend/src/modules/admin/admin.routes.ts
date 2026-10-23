import { Router, type RequestHandler } from 'express';
import { requireAuth, requirePlatformPermission } from '../../middleware/authenticate.js';
import type { AdminController } from './admin.controller.js';
import type { ReportsController } from '../reports/reports.controller.js';

/** `mfaGate` refuses platform administrators who have not turned on two-step sign-in (when required). */
export function adminRoutes(controller: AdminController, reports: ReportsController, mfaGate: RequestHandler): Router {
  const router = Router();
  router.use(requireAuth, mfaGate);
  router.get('/stats', requirePlatformPermission('platform.stats'), controller.stats);
  router.get('/users', requirePlatformPermission('platform.users.view'), controller.listUsers);
  router.patch('/users/:userId', requirePlatformPermission('platform.users.manage'), controller.updateUser);
  router.get('/families', requirePlatformPermission('platform.families.view'), controller.listFamilies);
  router.patch('/families/:familyId', requirePlatformPermission('platform.families.manage'), controller.updateFamily);
  router.get('/reports', requirePlatformPermission('platform.reports.manage'), reports.list);
  router.patch('/reports/:reportId', requirePlatformPermission('platform.reports.manage'), reports.resolve);
  return router;
}
