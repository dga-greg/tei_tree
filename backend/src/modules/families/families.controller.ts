import type { Request, Response } from 'express';
import { parse, parseIdParam } from '../../core/validation.js';
import { authOf } from '../../middleware/authenticate.js';
import { actorOf } from '../relationships/relationships.controller.js';
import { accessOf, FamilyAccess } from './family-access.js';
import { toFamilyView } from './family.mapper.js';
import type { FamiliesService } from './families.service.js';
import { createFamilyBody, setFounderBody, updateFamilyBody } from './family.validators.js';

export class FamiliesController {
  constructor(private readonly families: FamiliesService) {}

  listMine = async (req: Request, res: Response) => {
    res.json({ data: await this.families.listForUser(authOf(req).userId) });
  };

  create = async (req: Request, res: Response) => {
    const access = await this.families.create(actorOf(req), parse(createFamilyBody, req.body));
    res.status(201).json({ data: toFamilyView(access) });
  };

  get = (req: Request, res: Response) => {
    res.json({ data: toFamilyView(accessOf(req)) });
  };

  update = async (req: Request, res: Response) => {
    const access = accessOf(req);
    const family = await this.families.update(access, actorOf(req), parse(updateFamilyBody, req.body));
    res.json({ data: toFamilyView(new FamilyAccess(family, access.membership)) });
  };

  setFounder = async (req: Request, res: Response) => {
    const access = accessOf(req);
    const { memberId, reason } = parse(setFounderBody, req.body);
    const family = await this.families.setFounder(access, actorOf(req), parseIdParam(memberId, 'Person'), reason);
    res.json({ data: toFamilyView(new FamilyAccess(family, access.membership)) });
  };
}
