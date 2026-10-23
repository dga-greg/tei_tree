import type { Request, Response } from 'express';
import { parse, parseIdParam } from '../../core/validation.js';
import { authOf } from '../../middleware/authenticate.js';
import { createReportBody, listReportsQuery, resolveReportBody, type ReportsService } from './reports.service.js';

export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  create = async (req: Request, res: Response) => {
    res.status(201).json({ data: await this.reports.create(authOf(req).userId, parse(createReportBody, req.body), req.requestId, req.ip ?? null) });
  };

  list = async (req: Request, res: Response) => {
    res.json(await this.reports.list(parse(listReportsQuery, req.query)));
  };

  resolve = async (req: Request, res: Response) => {
    const actor = { userId: authOf(req).userId, requestId: req.requestId, ip: req.ip ?? null };
    res.json({ data: await this.reports.resolve(actor, parseIdParam(req.params['reportId'], 'Report'), parse(resolveReportBody, req.body)) });
  };
}
