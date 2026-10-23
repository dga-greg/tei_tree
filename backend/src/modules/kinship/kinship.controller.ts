import type { Request, Response } from 'express';
import { z } from 'zod';
import { parse, parseIdParam } from '../../core/validation.js';
import { accessOf } from '../families/family-access.js';
import type { KinshipService } from './kinship.service.js';

const betweenQuery = z.object({ a: z.string(), b: z.string() });

export class KinshipController {
  constructor(private readonly kinship: KinshipService) {}

  between = async (req: Request, res: Response) => {
    const { a, b } = parse(betweenQuery, req.query);
    res.json({ data: await this.kinship.between(accessOf(req), parseIdParam(a, 'Person'), parseIdParam(b, 'Person')) });
  };
}
