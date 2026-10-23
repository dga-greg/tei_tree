import type { Request, Response } from 'express';
import { parse, parseIdParam } from '../../core/validation.js';
import { accessOf } from '../families/family-access.js';
import { actorOf } from '../relationships/relationships.controller.js';
import { createMemberBody, listMembersQuery, updateMemberBody } from './member.validators.js';
import type { MembersService } from './members.service.js';

export class MembersController {
  constructor(private readonly members: MembersService) {}

  list = async (req: Request, res: Response) => {
    res.json(await this.members.list(accessOf(req), parse(listMembersQuery, req.query)));
  };

  /** Quick search for pickers: best matches first, at most 10. */
  search = async (req: Request, res: Response) => {
    const query = parse(listMembersQuery, { ...req.query, page: 1, pageSize: 10 });
    const result = await this.members.list(accessOf(req), query);
    res.json({ data: result.data });
  };

  attributeNames = async (req: Request, res: Response) => {
    res.json({ data: await this.members.attributeNames(accessOf(req)) });
  };

  create = async (req: Request, res: Response) => {
    const access = accessOf(req);
    const { person, links } = parse(createMemberBody, req.body);
    const doc = await this.members.create(access, actorOf(req), person, links);
    res.status(201).json({ data: await this.members.get(access, doc._id) });
  };

  get = async (req: Request, res: Response) => {
    res.json({ data: await this.members.get(accessOf(req), parseIdParam(req.params['memberId'], 'Person')) });
  };

  update = async (req: Request, res: Response) => {
    const access = accessOf(req);
    const id = parseIdParam(req.params['memberId'], 'Person');
    await this.members.update(access, actorOf(req), id, parse(updateMemberBody, req.body));
    res.json({ data: await this.members.get(access, id) });
  };

  remove = async (req: Request, res: Response) => {
    await this.members.remove(accessOf(req), actorOf(req), parseIdParam(req.params['memberId'], 'Person'));
    res.status(204).end();
  };
}
