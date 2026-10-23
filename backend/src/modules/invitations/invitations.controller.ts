import type { Request, Response } from 'express';
import { parse, parseIdParam } from '../../core/validation.js';
import { accessOf } from '../families/family-access.js';
import { actorOf } from '../relationships/relationships.controller.js';
import { createInvitationBody, tokenBody } from './invitation.validators.js';
import type { InvitationsService } from './invitations.service.js';

export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  list = async (req: Request, res: Response) => {
    res.json({ data: await this.invitations.list(accessOf(req)) });
  };

  create = async (req: Request, res: Response) => {
    res.status(201).json({ data: await this.invitations.create(accessOf(req), actorOf(req), parse(createInvitationBody, req.body)) });
  };

  resend = async (req: Request, res: Response) => {
    res.json({ data: await this.invitations.resend(accessOf(req), actorOf(req), parseIdParam(req.params['invitationId'], 'Invitation')) });
  };

  revoke = async (req: Request, res: Response) => {
    await this.invitations.revoke(accessOf(req), actorOf(req), parseIdParam(req.params['invitationId'], 'Invitation'));
    res.status(204).end();
  };

  /** Tokens travel in the body, never in URLs, so they do not end up in logs or browser history. */
  preview = async (req: Request, res: Response) => {
    res.json({ data: await this.invitations.preview(parse(tokenBody, req.body).token) });
  };

  accept = async (req: Request, res: Response) => {
    res.json({ data: await this.invitations.accept(parse(tokenBody, req.body).token, actorOf(req)) });
  };

  mine = async (req: Request, res: Response) => {
    res.json({ data: await this.invitations.mine(actorOf(req)) });
  };

  acceptMine = async (req: Request, res: Response) => {
    res.json({ data: await this.invitations.acceptMine(parseIdParam(req.params['invitationId'], 'Invitation'), actorOf(req)) });
  };
}
