import type { Request, Response } from 'express';
import { z } from 'zod';
import { parse, parseIdParam } from '../../core/validation.js';
import { accessOf } from '../families/family-access.js';
import type { MembersService } from '../members/members.service.js';
import { actorOf } from '../relationships/relationships.controller.js';
import type { GenerationScheduler } from './generation-scheduler.js';
import type { GenerationsReadService } from './generations.read.js';

const overrideBody = z
  .object({ number: z.number().int().min(1), reason: z.string().trim().min(3, 'Explain why this number is correct').max(1000) })
  .strict();

export class GenerationsController {
  constructor(
    private readonly read: GenerationsReadService,
    private readonly scheduler: GenerationScheduler,
    private readonly members: MembersService,
  ) {}

  summary = async (req: Request, res: Response) => {
    res.json({ data: await this.read.summary(accessOf(req)) });
  };

  trend = async (req: Request, res: Response) => {
    res.json({ data: await this.read.trend(accessOf(req)) });
  };

  conflicts = async (req: Request, res: Response) => {
    res.json({ data: await this.read.conflicts(accessOf(req)) });
  };

  dashboard = async (req: Request, res: Response) => {
    res.json({ data: await this.read.dashboard(accessOf(req)) });
  };

  recalculate = async (req: Request, res: Response) => {
    const access = accessOf(req);
    access.assert('generation.recalculate');
    await this.scheduler.request(access.familyId);
    res.status(202).json({ data: await this.read.summary(access) });
  };

  setOverride = async (req: Request, res: Response) => {
    const access = accessOf(req);
    const id = parseIdParam(req.params['memberId'], 'Person');
    await this.members.setGenerationOverride(access, actorOf(req), id, parse(overrideBody, req.body));
    res.json({ data: await this.members.get(access, id) });
  };

  clearOverride = async (req: Request, res: Response) => {
    const access = accessOf(req);
    const id = parseIdParam(req.params['memberId'], 'Person');
    await this.members.setGenerationOverride(access, actorOf(req), id, null);
    res.json({ data: await this.members.get(access, id) });
  };
}
