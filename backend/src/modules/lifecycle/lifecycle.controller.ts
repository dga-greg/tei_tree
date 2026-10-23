import type { Request, Response } from 'express';
import { parse, parseIdParam } from '../../core/validation.js';
import { authOf } from '../../middleware/authenticate.js';
import type { AuthCookies } from '../auth/cookies.js';
import { accessOf } from '../families/family-access.js';
import { actorOf } from '../relationships/relationships.controller.js';
import { deleteAccountBody, deleteFamilyBody, type LifecycleService } from './lifecycle.service.js';

export class LifecycleController {
  constructor(
    private readonly lifecycle: LifecycleService,
    private readonly cookies: AuthCookies,
  ) {}

  deleteAccount = async (req: Request, res: Response) => {
    await this.lifecycle.deleteAccount(actorOf(req), parse(deleteAccountBody, req.body).password);
    this.cookies.clear(res);
    res.status(204).end();
  };

  scheduleFamilyDeletion = async (req: Request, res: Response) => {
    res.status(202).json({ data: await this.lifecycle.scheduleFamilyDeletion(accessOf(req), actorOf(req), parse(deleteFamilyBody, req.body)) });
  };

  cancelFamilyDeletion = async (req: Request, res: Response) => {
    await this.lifecycle.cancelFamilyDeletion(actorOf(req), parseIdParam(req.params['familyId'], 'Family'));
    res.status(204).end();
  };

  scheduledDeletions = async (req: Request, res: Response) => {
    res.json({ data: await this.lifecycle.scheduledDeletions(authOf(req).userId) });
  };
}
