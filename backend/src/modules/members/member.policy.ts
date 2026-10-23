import type { Types } from 'mongoose';
import type { FamilyAccess } from '../families/family-access.js';
import type { FamilyMemberDoc } from './member.model.js';

/** Living people born less than this many years ago are treated as children. */
const ADULT_AGE = 18;
/** People with unknown status born longer ago than this are presumed deceased. */
const PRESUMED_DECEASED_AFTER_YEARS = 110;

type PersonLike = Pick<FamilyMemberDoc, '_id' | 'vitalStatus' | 'birthDate' | 'privacy'>;

/**
 * Decides, for one viewer, which people they may see and how much of each profile.
 * Applied server-side to every response that contains people. See docs/03-PERMISSIONS.md.
 */
export class MemberPolicy {
  private readonly year = new Date().getUTCFullYear();

  /**
   * @param targetBranchIds branches of the person being viewed; only needed for branch-scoped
   * moderators (see BranchesService.scopeFor). Without it, scoped moderators get read-only views.
   */
  constructor(
    readonly access: FamilyAccess,
    private readonly targetBranchIds: string[] = [],
  ) {}

  get isGuest(): boolean {
    return this.access.role === 'guest';
  }

  /** May edit people directly (admins; moderators within scope). Branch scoping arrives with branches. */
  get isEditor(): boolean {
    return this.access.can('member.update', { branchIds: this.targetBranchIds });
  }

  isOwn(person: Pick<PersonLike, '_id'>): boolean {
    return this.access.ownProfileId?.equals(person._id) ?? false;
  }

  presumedLiving(person: PersonLike): boolean {
    if (person.vitalStatus === 'living') return true;
    if (person.vitalStatus === 'deceased') return false;
    const born = person.birthDate?.year;
    return !born || born > this.year - PRESUMED_DECEASED_AFTER_YEARS;
  }

  isMinor(person: PersonLike): boolean {
    const born = person.birthDate?.year;
    return this.presumedLiving(person) && born != null && this.year - born < ADULT_AGE;
  }

  /** Guests see only deceased people whose profile the family has made public. */
  isVisible(person: PersonLike): boolean {
    if (!this.isGuest) return true;
    return this.access.isPublicFamily && person.privacy?.level === 'public' && person.vitalStatus === 'deceased';
  }

  /** MongoDB filter equivalent of `isVisible`, for list queries. */
  visibilityFilter(): Record<string, unknown> {
    return this.isGuest ? { 'privacy.level': 'public', vitalStatus: 'deceased' } : {};
  }

  /** `names`: only names and generation; `full`: the profile (dates may still be reduced). */
  detailLevel(person: PersonLike): 'full' | 'names' {
    if (this.isEditor || this.isOwn(person) || this.isGuest) return 'full';
    if (person.privacy?.level === 'restricted') return 'names';
    if (this.presumedLiving(person) && this.access.family.privacy?.showLivingToMembers === false) return 'names';
    return 'full';
  }

  /** Children's and opted-out exact dates are shown as a year only, except to editors and the person. */
  reduceDates(person: PersonLike): boolean {
    if (this.isEditor || this.isOwn(person)) return false;
    return this.isMinor(person) || person.privacy?.hideDates === true;
  }

  canViewPrivate(person: Pick<PersonLike, '_id'>): boolean {
    return this.access.can('member.view_private', { branchIds: this.targetBranchIds, ownedByViewer: this.isOwn(person) });
  }

  isFounder(id: Types.ObjectId): boolean {
    return this.access.family.foundingMemberId?.equals(id) ?? false;
  }
}
