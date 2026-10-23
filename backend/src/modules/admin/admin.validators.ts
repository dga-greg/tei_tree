import { z } from 'zod';
import { PLATFORM_ROLES } from '@fh/contracts';
import { paginationQuery } from '../../core/validation.js';

export const listUsersQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

export const updateUserBody = z
  .object({
    status: z.enum(['active', 'suspended']).optional(),
    platformRole: z.enum(PLATFORM_ROLES).optional(),
  })
  .strict()
  .refine((b) => b.status !== undefined || b.platformRole !== undefined, { message: 'Nothing to update' });
