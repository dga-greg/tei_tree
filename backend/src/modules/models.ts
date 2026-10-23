/** Registers every Mongoose model so indexes are created for all collections at start-up. */
import './users/user.model.js';
import './auth/session.model.js';
import './auth/password-reset.model.js';
import './auth/email-verification.model.js';
import './auth/mfa-challenge.model.js';
import './families/family.model.js';
import './families/membership.model.js';
import './members/member.model.js';
import './relationships/relationship.model.js';
import './branches/branch.model.js';
import './media/media.model.js';
import './generations/generation-snapshot.model.js';
import './audit/audit-log.model.js';
