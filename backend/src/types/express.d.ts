import type { AuthContext } from '../middleware/authenticate.js';
import type { FamilyAccess } from '../modules/families/family-access.js';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id, echoed in the X-Request-Id response header and in error bodies. */
      requestId: string;
      /** Set by `authenticate` when a valid access token is presented. */
      auth?: AuthContext;
      /** Why authentication failed, when a token was presented but rejected. */
      authFailure?: 'expired' | 'invalid';
      /** Set by `loadFamilyAccess` on family-scoped routes. */
      familyAccess?: FamilyAccess;
    }
  }
}

export {};
