import type { Request, Response } from 'express';
import { parseIdParam } from '../../core/validation.js';
import { accessOf } from '../families/family-access.js';
import { actorOf } from '../relationships/relationships.controller.js';
import type { ImportService } from './import.service.js';

export class ImportController {
  constructor(private readonly imports: ImportService) {}

  preview = async (req: Request, res: Response) => {
    res.json({ data: await this.imports.preview(accessOf(req), req) });
  };

  commit = async (req: Request, res: Response) => {
    res.status(201).json({ data: await this.imports.commit(accessOf(req), actorOf(req), req) });
  };

  list = async (req: Request, res: Response) => {
    res.json({ data: await this.imports.list(accessOf(req)) });
  };

  undo = async (req: Request, res: Response) => {
    res.json({ data: await this.imports.undo(accessOf(req), actorOf(req), parseIdParam(req.params['importId'], 'Import')) });
  };
}
