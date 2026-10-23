import { z } from 'zod';
import {
  GENDERS,
  GENERATION_STATUSES,
  MEMBER_PRIVACY_LEVELS,
  MEMBER_SORTS,
  PARENT_CHILD_SUBTYPES,
  PARTNERSHIP_STATUSES,
  PARTNERSHIP_SUBTYPES,
  VERIFICATION_STATES,
  VITAL_STATUSES,
} from '@fh/contracts';
import { optionalFuzzyDate } from '../../core/fuzzy-date.js';
import { objectId, paginationQuery } from '../../core/validation.js';

const text = (max: number) => z.string().trim().max(max);

const timelineEntry = z
  .object({
    title: text(200).min(1),
    organisation: text(200).optional(),
    from: optionalFuzzyDate,
    to: optionalFuzzyDate,
    description: text(2000).optional(),
  })
  .strict();

export const sourceReference = z
  .object({
    title: text(300).min(1),
    citation: text(2000).optional(),
    url: z.url({ protocol: /^https?$/ }).max(2000).optional(),
  })
  .strict();

const memberFields = {
  firstName: text(100).min(1, 'Enter a first name'),
  middleNames: text(200),
  surname: text(100),
  maidenName: text(100),
  previousNames: z.array(text(100).min(1)).max(20),
  preferredName: text(100),
  title: text(60),
  gender: z.enum(GENDERS).nullable(),
  vitalStatus: z.enum(VITAL_STATUSES),
  birthDate: optionalFuzzyDate,
  birthPlace: text(200),
  deathDate: optionalFuzzyDate,
  deathPlace: text(200),
  nationality: text(100),
  hometown: text(120),
  maternalLine: text(80),
  paternalLine: text(80),
  totem: text(80),
  biography: text(50_000),
  education: z.array(timelineEntry).max(50),
  occupations: z.array(timelineEntry).max(50),
  achievements: z.array(text(500).min(1)).max(100),
  sources: z.array(sourceReference).max(100),
  privacy: z.object({ level: z.enum(MEMBER_PRIVACY_LEVELS).optional(), hideDates: z.boolean().optional() }).strict(),
  contact: z
    .object({
      email: z.union([z.email().max(254), z.literal('')]).optional(),
      phone: text(40).optional(),
      address: text(500).optional(),
    })
    .strict()
    .nullable(),
  /** A published photo from the family archive. */
  profilePhotoMediaId: objectId.nullable(),
};

const memberShape = z.object(memberFields).partial().required({ firstName: true }).strict();

/** Cross-field rules shared by create and the merged result of an update. */
export function checkMemberConsistency(
  m: { vitalStatus?: string; deathDate?: unknown; deathPlace?: string; privacy?: { level?: string } },
  ctx: z.RefinementCtx,
): void {
  if (m.vitalStatus === 'living' && (m.deathDate || m.deathPlace)) {
    ctx.addIssue({ code: 'custom', path: ['vitalStatus'], message: 'A living person cannot have a date or place of death' });
  }
  if (m.privacy?.level === 'public' && m.vitalStatus !== 'deceased') {
    ctx.addIssue({ code: 'custom', path: ['privacy', 'level'], message: 'Only deceased people can be made public' });
  }
}

export const memberInput = memberShape.superRefine((m, ctx) => checkMemberConsistency(m, ctx));

const verification = z.enum(VERIFICATION_STATES).default('unverified');

const parentLink = z.object({ memberId: objectId, subtype: z.enum(PARENT_CHILD_SUBTYPES), verification }).strict();
const partnerLink = z
  .object({ memberId: objectId, subtype: z.enum(PARTNERSHIP_SUBTYPES), status: z.enum(PARTNERSHIP_STATUSES).optional(), verification })
  .strict();

export const createMemberBody = z
  .object({
    person: memberInput,
    links: z
      .object({
        parents: z.array(parentLink).max(10).optional(),
        children: z.array(parentLink).max(50).optional(),
        partners: z.array(partnerLink).max(20).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** A partial person (used by corrections proposed for review). */
export const memberPatch = z.object(memberFields).partial().strict();

export const updateMemberBody = memberPatch.extend({ version: z.number().int().min(0) }).strict();
export type UpdateMemberParsed = z.output<typeof updateMemberBody>;

export const listMembersQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  generation: z.coerce.number().int().min(1).optional(),
  generationStatus: z.enum(GENERATION_STATUSES).optional(),
  branchId: objectId.optional(),
  vitalStatus: z.enum(VITAL_STATUSES).optional(),
  hometown: z.string().trim().max(120).optional(),
  birthYear: z.coerce.number().int().min(1).max(3000).optional(),
  sort: z.enum(MEMBER_SORTS).default('name'),
});
export type ListMembersQueryParsed = z.output<typeof listMembersQuery>;

export type MemberInputParsed = z.output<typeof memberInput>;
