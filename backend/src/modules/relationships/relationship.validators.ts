import { z } from 'zod';
import {
  PARENT_CHILD_SUBTYPES,
  PARTNERSHIP_STATUSES,
  PARTNERSHIP_SUBTYPES,
  RELATIONSHIP_TYPES,
  VERIFICATION_STATES,
} from '@fh/contracts';
import { optionalFuzzyDate } from '../../core/fuzzy-date.js';
import { objectId } from '../../core/validation.js';
import { sourceReference } from '../members/member.validators.js';

const subtype = z.enum([...PARENT_CHILD_SUBTYPES, ...PARTNERSHIP_SUBTYPES]);

function checkSubtype(r: { type?: string; subtype?: string; status?: string }, ctx: z.RefinementCtx) {
  if (!r.type || !r.subtype) return;
  const valid =
    r.type === 'parent_child'
      ? (PARENT_CHILD_SUBTYPES as readonly string[]).includes(r.subtype)
      : (PARTNERSHIP_SUBTYPES as readonly string[]).includes(r.subtype);
  if (!valid) ctx.addIssue({ code: 'custom', path: ['subtype'], message: `"${r.subtype}" is not a valid ${r.type.replace('_', '-')} type` });
  if (r.type === 'parent_child' && r.status) ctx.addIssue({ code: 'custom', path: ['status'], message: 'Only partnerships have a status' });
}

export const createRelationshipBody = z
  .object({
    type: z.enum(RELATIONSHIP_TYPES),
    personA: objectId,
    personB: objectId,
    subtype,
    status: z.enum(PARTNERSHIP_STATUSES).optional(),
    startDate: optionalFuzzyDate,
    endDate: optionalFuzzyDate,
    verification: z.enum(VERIFICATION_STATES).default('unverified'),
    notes: z.string().trim().max(5000).optional(),
    sources: z.array(sourceReference).max(100).optional(),
  })
  .strict()
  .superRefine(checkSubtype);
export type CreateRelationshipParsed = z.output<typeof createRelationshipBody>;

export const updateRelationshipBody = z
  .object({
    version: z.number().int().min(0),
    subtype: subtype.optional(),
    status: z.enum(PARTNERSHIP_STATUSES).optional(),
    startDate: optionalFuzzyDate,
    endDate: optionalFuzzyDate,
    verification: z.enum(VERIFICATION_STATES).optional(),
    notes: z.string().trim().max(5000).optional(),
    sources: z.array(sourceReference).max(100).optional(),
  })
  .strict();
export type UpdateRelationshipParsed = z.output<typeof updateRelationshipBody>;

export const relationshipPatch = updateRelationshipBody.omit({ version: true });

export { checkSubtype };
