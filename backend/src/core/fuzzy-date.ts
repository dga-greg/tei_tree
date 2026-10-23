import { z } from 'zod';
import { DATE_QUALIFIERS, fuzzyDateSortKey, type FuzzyDate } from '@fh/contracts';

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Validates a partial/approximate date and derives its sort key. A date needs a year or a text
 * description; a day needs a month; `between` needs an end year after the start year.
 */
export const fuzzyDateSchema = z
  .object({
    year: z.number().int().min(1).max(new Date().getUTCFullYear() + 1).optional(),
    month: z.number().int().min(1).max(12).optional(),
    day: z.number().int().min(1).max(31).optional(),
    qualifier: z.enum(DATE_QUALIFIERS).default('exact'),
    endYear: z.number().int().min(1).max(new Date().getUTCFullYear() + 1).optional(),
    text: z.string().trim().max(200).optional(),
    /** Accepted for round-trips but always recomputed. */
    sortKey: z.number().nullable().optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.year === undefined && !d.text) ctx.addIssue({ code: 'custom', path: ['year'], message: 'Enter a year or describe the date' });
    if (d.day !== undefined && d.month === undefined) ctx.addIssue({ code: 'custom', path: ['month'], message: 'A day needs a month' });
    if ((d.month !== undefined || d.day !== undefined) && d.year === undefined)
      ctx.addIssue({ code: 'custom', path: ['year'], message: 'A month or day needs a year' });
    if (d.day !== undefined && d.month !== undefined && d.day > DAYS_IN_MONTH[d.month - 1]!)
      ctx.addIssue({ code: 'custom', path: ['day'], message: 'That day does not exist in this month' });
    if (d.qualifier === 'between') {
      if (d.endYear === undefined) ctx.addIssue({ code: 'custom', path: ['endYear'], message: 'Enter the end of the range' });
      else if (d.year !== undefined && d.endYear < d.year)
        ctx.addIssue({ code: 'custom', path: ['endYear'], message: 'The range must end after it starts' });
    } else if (d.endYear !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['endYear'], message: 'Only date ranges have an end year' });
    }
  })
  .transform(({ sortKey: _ignored, ...d }): FuzzyDate => ({ ...d, sortKey: fuzzyDateSortKey(d) }));

export const optionalFuzzyDate = fuzzyDateSchema.nullable().optional();

/** True when `a` is known to be later than `b` (used to reject death-before-birth). */
export function isClearlyAfter(a: FuzzyDate | null | undefined, b: FuzzyDate | null | undefined): boolean {
  if (!a?.year || !b?.year) return false;
  if (a.qualifier !== 'exact' || b.qualifier !== 'exact') return a.year > b.year + 1;
  return (a.sortKey ?? 0) > (b.sortKey ?? 0) && a.year > b.year;
}
