import { z } from 'zod';
import { objectId } from '../../core/validation.js';

const name = z.string().trim().min(2, 'Enter a branch name').max(120);

export const createBranchBody = z
  .object({
    name,
    foundingMemberId: objectId,
    description: z.string().trim().max(2000).optional(),
    history: z.string().trim().max(50_000).optional(),
  })
  .strict();

export const updateBranchBody = z
  .object({
    name: name.optional(),
    description: z.string().trim().max(2000).optional(),
    history: z.string().trim().max(50_000).optional(),
  })
  .strict();
