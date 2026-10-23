import type { Request, Response } from 'express';
import { z } from 'zod';
import { FAMILY_ROLES } from '@fh/contracts';
import { objectId, paginationQuery, parse, parseIdParam } from '../../core/validation.js';
import type { AuditReadService } from '../audit/audit.read.js';
import type { MembersService } from '../members/members.service.js';
import { actorOf } from '../relationships/relationships.controller.js';
import { accessOf } from './family-access.js';
import type { MembershipsService } from './memberships.service.js';

const updateMembershipBody = z.object({ role: z.enum(FAMILY_ROLES).optional(), moderatedBranchIds: z.array(objectId).max(50).optional(), treasurer: z.boolean().optional() }).strict();
const auditQuery = paginationQuery.extend({ targetType: z.string().max(40).optional(), targetId: objectId.optional(), action: z.string().max(60).optional() });

/** Family membership management, audit history and restoring removed records. */
export class CollaborationController {
  constructor(
    private readonly memberships: MembershipsService,
    private readonly audit: AuditReadService,
    private readonly members: MembersService,
  ) {}

  listMemberships = async (req: Request, res: Response) => {
    res.json({ data: await this.memberships.list(accessOf(req)) });
  };

  updateMembership = async (req: Request, res: Response) => {
    const id = parseIdParam(req.params['membershipId'], 'Member');
    res.json({ data: await this.memberships.update(accessOf(req), actorOf(req), id, parse(updateMembershipBody, req.body)) });
  };

  removeMembership = async (req: Request, res: Response) => {
    await this.memberships.remove(accessOf(req), actorOf(req), parseIdParam(req.params['membershipId'], 'Member'));
    res.status(204).end();
  };

  unlinkProfile = async (req: Request, res: Response) => {
    await this.memberships.unlinkProfile(accessOf(req), actorOf(req), parseIdParam(req.params['membershipId'], 'Member'));
    res.status(204).end();
  };

  leave = async (req: Request, res: Response) => {
    const access = accessOf(req);
    if (!access.membership) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'You are not a member of this family', requestId: req.requestId } });
      return;
    }
    await this.memberships.remove(access, actorOf(req), access.membership._id);
    res.status(204).end();
  };

  auditLog = async (req: Request, res: Response) => {
    res.json(await this.audit.list(accessOf(req), parse(auditQuery, req.query)));
  };

  restore = async (req: Request, res: Response) => {
    res.json({ data: await this.audit.restore(accessOf(req), actorOf(req), parseIdParam(req.params['auditId'], 'History entry')) });
  };

  removedMembers = async (req: Request, res: Response) => {
    res.json({ data: await this.members.listDeleted(accessOf(req)) });
  };

  restoreMember = async (req: Request, res: Response) => {
    res.json({ data: await this.members.restore(accessOf(req), actorOf(req), parseIdParam(req.params['memberId'], 'Person')) });
  };
}
