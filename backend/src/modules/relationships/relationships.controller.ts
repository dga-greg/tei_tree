import type { Request, Response } from 'express';
import { parse, parseIdParam } from '../../core/validation.js';
import { authOf } from '../../middleware/authenticate.js';
import { accessOf } from '../families/family-access.js';
import { toRelationshipView } from './relationship.mapper.js';
import { createRelationshipBody, updateRelationshipBody } from './relationship.validators.js';
import type { Actor, RelationshipsService } from './relationships.service.js';

export function actorOf(req: Request): Actor {
  const auth = authOf(req);
  return { userId: auth.userId, sessionId: auth.sessionId, requestId: req.requestId, ip: req.ip ?? null };
}

export class RelationshipsController {
  constructor(private readonly relationships: RelationshipsService) {}

  create = async (req: Request, res: Response) => {
    const edge = await this.relationships.create(accessOf(req), actorOf(req), parse(createRelationshipBody, req.body));
    res.status(201).json({ data: toRelationshipView(edge) });
  };

  get = async (req: Request, res: Response) => {
    const access = accessOf(req);
    res.json({ data: toRelationshipView(await this.relationships.get(access, parseIdParam(req.params['relationshipId'], 'Relationship'))) });
  };

  update = async (req: Request, res: Response) => {
    const id = parseIdParam(req.params['relationshipId'], 'Relationship');
    const edge = await this.relationships.update(accessOf(req), actorOf(req), id, parse(updateRelationshipBody, req.body));
    res.json({ data: toRelationshipView(edge) });
  };

  remove = async (req: Request, res: Response) => {
    await this.relationships.remove(accessOf(req), actorOf(req), parseIdParam(req.params['relationshipId'], 'Relationship'));
    res.status(204).end();
  };
}
