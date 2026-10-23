import type { Request, Response } from 'express';
import { parse, parseIdParam } from '../../core/validation.js';
import { accessOf } from '../families/family-access.js';
import { actorOf } from '../relationships/relationships.controller.js';
import { dismissBody, duplicatesQuery, mergeBody, type DuplicatesService } from './duplicates.service.js';

export class DuplicatesController {
  constructor(private readonly duplicates: DuplicatesService) {}

  list = async (req: Request, res: Response) => {
    res.json({ data: await this.duplicates.list(accessOf(req), parse(duplicatesQuery, req.query)) });
  };

  dismiss = async (req: Request, res: Response) => {
    await this.duplicates.dismiss(accessOf(req), actorOf(req), parse(dismissBody, req.body));
    res.status(204).end();
  };

  merge = async (req: Request, res: Response) => {
    res.json({ data: await this.duplicates.merge(accessOf(req), actorOf(req), parseIdParam(req.params['memberId'], 'Person'), parse(mergeBody, req.body)) });
  };

  merges = async (req: Request, res: Response) => {
    res.json({ data: await this.duplicates.listMerges(accessOf(req)) });
  };

  undo = async (req: Request, res: Response) => {
    res.json({ data: await this.duplicates.undoMerge(accessOf(req), actorOf(req), parseIdParam(req.params['mergeId'], 'Merge')) });
  };
}
