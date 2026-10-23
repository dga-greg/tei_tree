import type { Request, Response } from 'express';
import { z } from 'zod';
import { CONTRIBUTION_KINDS, CONTRIBUTION_STATUSES } from '@fh/contracts';
import { objectId, parse, parseIdParam } from '../../core/validation.js';
import { accessOf } from '../families/family-access.js';
import { actorOf } from '../relationships/relationships.controller.js';
import type { ContributionsService } from './contributions.service.js';

const submitBody = z
  .object({ kind: z.enum(CONTRIBUTION_KINDS), targetId: objectId.optional(), payload: z.record(z.string(), z.unknown()).default({}), note: z.string().trim().max(5000).optional() })
  .strict();
const listQuery = z.object({ status: z.enum([...CONTRIBUTION_STATUSES, 'open']).optional(), mine: z.enum(['true', 'false']).optional() });
const approveBody = z.object({ note: z.string().trim().max(5000).optional(), force: z.boolean().optional() }).strict();
const rejectBody = z.object({ note: z.string().trim().min(3, 'Explain the decision to the person who suggested it').max(5000) }).strict();
const messageBody = z.object({ message: z.string().trim().min(2).max(5000) }).strict();
const respondBody = z.object({ message: z.string().trim().min(2).max(5000), payload: z.record(z.string(), z.unknown()).optional() }).strict();
const claimBody = z.object({ memberId: objectId, evidence: z.string().trim().max(2000).optional() }).strict();

export class ContributionsController {
  constructor(private readonly contributions: ContributionsService) {}

  private id(req: Request) {
    return parseIdParam(req.params['contributionId'], 'Contribution');
  }

  list = async (req: Request, res: Response) => {
    const q = parse(listQuery, req.query);
    res.json({ data: await this.contributions.list(accessOf(req), { status: q.status, mine: q.mine === 'true' }) });
  };

  get = async (req: Request, res: Response) => {
    res.json({ data: await this.contributions.get(accessOf(req), this.id(req)) });
  };

  submit = async (req: Request, res: Response) => {
    res.status(201).json({ data: await this.contributions.submit(accessOf(req), actorOf(req), parse(submitBody, req.body)) });
  };

  claim = async (req: Request, res: Response) => {
    const { memberId, evidence } = parse(claimBody, req.body);
    res.status(201).json({ data: await this.contributions.submit(accessOf(req), actorOf(req), { kind: 'claim.profile', targetId: memberId, payload: { evidence }, note: evidence }) });
  };

  approve = async (req: Request, res: Response) => {
    res.json({ data: await this.contributions.approve(accessOf(req), actorOf(req), this.id(req), parse(approveBody, req.body)) });
  };

  reject = async (req: Request, res: Response) => {
    res.json({ data: await this.contributions.reject(accessOf(req), actorOf(req), this.id(req), parse(rejectBody, req.body).note) });
  };

  requestClarification = async (req: Request, res: Response) => {
    res.json({ data: await this.contributions.requestClarification(accessOf(req), actorOf(req), this.id(req), parse(messageBody, req.body).message) });
  };

  respond = async (req: Request, res: Response) => {
    const { message, payload } = parse(respondBody, req.body);
    res.json({ data: await this.contributions.respond(accessOf(req), actorOf(req), this.id(req), message, payload) });
  };

  withdraw = async (req: Request, res: Response) => {
    res.json({ data: await this.contributions.withdraw(accessOf(req), actorOf(req), this.id(req)) });
  };
}
