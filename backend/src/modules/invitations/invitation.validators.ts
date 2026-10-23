import { z } from 'zod';
import { FAMILY_ROLES } from '@fh/contracts';
import { email, objectId } from '../../core/validation.js';

export const createInvitationBody = z
  .object({
    email,
    role: z.enum(FAMILY_ROLES).default('family_member'),
    suggestedProfileId: objectId.nullable().optional(),
    message: z.string().trim().max(1000).optional(),
  })
  .strict();

export const tokenBody = z.object({ token: z.string().min(20).max(200) }).strict();
