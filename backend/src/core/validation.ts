import { z } from 'zod';
import { Types } from 'mongoose';
import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX } from '@fh/contracts';
import { AppError } from './errors.js';

/** Parses `data` with `schema` or throws a VALIDATION_FAILED error listing every issue. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw new AppError(
    'VALIDATION_FAILED',
    'Request validation failed',
    result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  );
}

export const objectId = z
  .string()
  .refine((v) => Types.ObjectId.isValid(v) && /^[a-f\d]{24}$/i.test(v), 'Invalid identifier');

/** Parses an id from the URL; malformed ids are reported as "not found", never as a 500. */
export function parseIdParam(value: unknown, what: string): Types.ObjectId {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw AppError.notFound(what);
  return new Types.ObjectId(value);
}

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
});

export type Pagination = z.output<typeof paginationQuery>;

export function pageMeta(p: Pagination, total: number) {
  return { page: p.page, pageSize: p.pageSize, total, totalPages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid e-mail address').max(254));
