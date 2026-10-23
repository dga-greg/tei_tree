import type { Request, Response } from 'express';
import { parse } from '../../core/validation.js';
import { accessOf } from '../families/family-access.js';
import { lineageQuery, type LineageService } from './lineage.service.js';

export class LineageController {
  constructor(private readonly lineage: LineageService) {}

  overview = async (req: Request, res: Response) => {
    res.json({ data: await this.lineage.overview(accessOf(req), parse(lineageQuery, req.query).side) });
  };
}
