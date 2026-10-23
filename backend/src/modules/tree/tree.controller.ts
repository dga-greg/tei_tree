import type { Request, Response } from 'express';
import { z } from 'zod';
import { TREE_MAX_DEPTH } from '@fh/contracts';
import { parse, parseIdParam } from '../../core/validation.js';
import { accessOf } from '../families/family-access.js';
import type { TreeService } from './tree.service.js';

const depthQuery = z.object({ depth: z.coerce.number().int().min(1).max(TREE_MAX_DEPTH).default(3) });

export class TreeController {
  constructor(private readonly tree: TreeService) {}

  root = async (req: Request, res: Response) => {
    const { depth } = parse(depthQuery, req.query);
    res.json({ data: await this.tree.root(accessOf(req), depth) });
  };

  children = async (req: Request, res: Response) => {
    res.json({ data: await this.tree.children(accessOf(req), parseIdParam(req.params['memberId'], 'Person')) });
  };

  descendants = async (req: Request, res: Response) => {
    const { depth } = parse(depthQuery, req.query);
    res.json({ data: await this.tree.descendants(accessOf(req), parseIdParam(req.params['memberId'], 'Person'), depth) });
  };

  ancestors = async (req: Request, res: Response) => {
    const { depth } = parse(depthQuery, req.query);
    res.json({ data: await this.tree.ancestors(accessOf(req), parseIdParam(req.params['memberId'], 'Person'), depth) });
  };

  branch = async (req: Request, res: Response) => {
    const { depth } = parse(depthQuery, req.query);
    res.json({ data: await this.tree.branch(accessOf(req), parseIdParam(req.params['branchId'], 'Branch'), depth) });
  };
}
