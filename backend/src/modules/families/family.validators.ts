import { z } from 'zod';
import { FAMILY_NAME_MAX_LENGTH, FAMILY_STATUSES, FAMILY_VISIBILITIES, MESSAGE_OPENING_MAX_LENGTH, MESSAGE_SIGN_OFF_MAX_LENGTH } from '@fh/contracts';
import { objectId, paginationQuery } from '../../core/validation.js';
import { memberInput } from '../members/member.validators.js';

const origin = z
  .object({
    hometown: z.string().trim().max(120).optional(),
    region: z.string().trim().max(120).optional(),
    country: z.string().trim().max(120).optional(),
  })
  .strict();

const privacy = z
  .object({
    visibility: z.enum(FAMILY_VISIBILITIES).optional(),
    showLivingToMembers: z.boolean().optional(),
    allowMemberUploads: z.boolean().optional(),
    requireApprovalForMemberEdits: z.boolean().optional(),
  })
  .strict();

const generationPolicy = z.object({ countAdoptive: z.boolean().optional() }).strict();

const lineSettings = z.object({ enabled: z.boolean(), label: z.string().trim().min(1).max(40) }).strict();
export const lineageSettings = z
  .object({
    maternal: lineSettings,
    paternal: lineSettings,
    totemFollows: z.enum(['maternal', 'paternal']),
    throughAdoption: z.boolean(),
  })
  .strict();

const messageTemplate = z
  .object({
    opening: z.string().trim().max(MESSAGE_OPENING_MAX_LENGTH),
    signOff: z.string().trim().max(MESSAGE_SIGN_OFF_MAX_LENGTH),
  })
  .strict();

const name = z.string().trim().min(2, 'Enter the family name').max(FAMILY_NAME_MAX_LENGTH);

export const createFamilyBody = z
  .object({
    name,
    description: z.string().trim().max(2000).optional(),
    history: z.string().trim().max(50_000).optional(),
    origin: origin.optional(),
    privacy: privacy.optional(),
    generationPolicy: generationPolicy.optional(),
    lineage: lineageSettings.optional(),
    founder: memberInput.optional(),
  })
  .strict();
export type CreateFamilyParsed = z.output<typeof createFamilyBody>;

export const updateFamilyBody = z
  .object({
    version: z.number().int().min(0),
    name: name.optional(),
    description: z.string().trim().max(2000).optional(),
    history: z.string().trim().max(50_000).optional(),
    origin: origin.optional(),
    privacy: privacy.optional(),
    generationPolicy: generationPolicy.optional(),
    lineage: lineageSettings.optional(),
    messageTemplate: messageTemplate.optional(),
  })
  .strict();
export type UpdateFamilyParsed = z.output<typeof updateFamilyBody>;

export const setFounderBody = z.object({ memberId: objectId, reason: z.string().trim().max(1000).optional() }).strict();

export const adminListFamiliesQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(FAMILY_STATUSES).optional(),
});

export const adminUpdateFamilyBody = z.object({ status: z.enum(FAMILY_STATUSES).exclude(['pending_deletion']) }).strict();
