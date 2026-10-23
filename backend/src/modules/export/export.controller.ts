import type { Request, Response } from 'express';
import { contentDisposition } from '../../infra/storage.js';
import { parse } from '../../core/validation.js';
import { authOf } from '../../middleware/authenticate.js';
import { accessOf } from '../families/family-access.js';
import { actorOf } from '../relationships/relationships.controller.js';
import { exportQuery, type ExportService } from './export.service.js';

export class ExportController {
  constructor(private readonly exports: ExportService) {}

  family = async (req: Request, res: Response) => {
    const file = await this.exports.familyExport(accessOf(req), actorOf(req), parse(exportQuery, req.query));
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', contentDisposition('attachment', file.filename));
    res.send(file.body);
  };

  personal = async (req: Request, res: Response) => {
    const file = await this.exports.personalExport(authOf(req).userId);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition('attachment', file.filename));
    res.send(file.body);
  };
}
