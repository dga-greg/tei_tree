import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const VALID = /^[A-Za-z0-9._-]{8,64}$/;

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && VALID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};
