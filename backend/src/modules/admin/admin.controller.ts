import type { Request, Response } from 'express';
import { parse, parseIdParam } from '../../core/validation.js';
import { authOf } from '../../middleware/authenticate.js';
import type { AdminService } from './admin.service.js';
import { listUsersQuery, updateUserBody } from './admin.validators.js';
import { adminListFamiliesQuery, adminUpdateFamilyBody } from '../families/family.validators.js';

export class AdminController {
  constructor(private readonly admin: AdminService) {}

  stats = async (_req: Request, res: Response) => {
    res.json({ data: await this.admin.stats() });
  };

  listUsers = async (req: Request, res: Response) => {
    res.json(await this.admin.listUsers(parse(listUsersQuery, req.query)));
  };

  updateUser = async (req: Request, res: Response) => {
    const userId = parseIdParam(req.params['userId'], 'User');
    const patch = parse(updateUserBody, req.body);
    const actor = { userId: authOf(req).userId, requestId: req.requestId, ip: req.ip ?? null };
    res.json({ data: await this.admin.updateUser(actor, userId, patch) });
  };

  listFamilies = async (req: Request, res: Response) => {
    res.json(await this.admin.listFamilies(parse(adminListFamiliesQuery, req.query)));
  };

  updateFamily = async (req: Request, res: Response) => {
    const familyId = parseIdParam(req.params['familyId'], 'Family');
    const { status } = parse(adminUpdateFamilyBody, req.body);
    await this.admin.updateFamilyStatus({ userId: authOf(req).userId, requestId: req.requestId, ip: req.ip ?? null }, familyId, status);
    res.status(204).end();
  };
}
