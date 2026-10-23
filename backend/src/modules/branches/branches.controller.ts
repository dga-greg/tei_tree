import type { Request, Response } from 'express';
import { parse, parseIdParam } from '../../core/validation.js';
import { accessOf } from '../families/family-access.js';
import { actorOf } from '../relationships/relationships.controller.js';
import { createBranchBody, updateBranchBody } from './branch.validators.js';
import type { BranchesService } from './branches.service.js';

export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  list = async (req: Request, res: Response) => {
    res.json({ data: await this.branches.list(accessOf(req)) });
  };

  get = async (req: Request, res: Response) => {
    res.json({ data: await this.branches.get(accessOf(req), parseIdParam(req.params['branchId'], 'Branch')) });
  };

  create = async (req: Request, res: Response) => {
    res.status(201).json({ data: await this.branches.create(accessOf(req), actorOf(req), parse(createBranchBody, req.body)) });
  };

  createForFounderChildren = async (req: Request, res: Response) => {
    res.status(201).json({ data: await this.branches.createForFounderChildren(accessOf(req), actorOf(req)) });
  };

  update = async (req: Request, res: Response) => {
    const id = parseIdParam(req.params['branchId'], 'Branch');
    res.json({ data: await this.branches.update(accessOf(req), actorOf(req), id, parse(updateBranchBody, req.body)) });
  };

  remove = async (req: Request, res: Response) => {
    await this.branches.remove(accessOf(req), actorOf(req), parseIdParam(req.params['branchId'], 'Branch'));
    res.status(204).end();
  };
}
