import { Types } from 'mongoose';
import { z } from 'zod';
import { ARCHIVE_PRIVACY, type PersonCard } from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import { objectId } from '../../core/validation.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyMemberModel } from '../members/member.model.js';
import { toPersonCard } from '../members/member.mapper.js';
import { MemberPolicy } from '../members/member.policy.js';
import type { Actor } from '../relationships/relationships.service.js';
import { UserModel } from '../users/user.model.js';

export const archivePrivacy = z.enum(ARCHIVE_PRIVACY);
export const idList = z.array(objectId).max(100);

/** Administrators and moderators look after the archive: they see items marked "admins" and review additions. */
export function isArchiveManager(access: FamilyAccess): boolean {
  return access.role === 'family_admin' || access.role === 'family_moderator';
}

/** People a guest may not see. Archive items about any of them are hidden from guests entirely. */
async function guestHiddenMemberIds(access: FamilyAccess): Promise<Types.ObjectId[]> {
  const rows = await FamilyMemberModel.find(
    { familyId: access.familyId, deletedAt: null, $nor: [{ 'privacy.level': 'public', vitalStatus: 'deceased' }] },
    { _id: 1 },
  ).lean();
  return rows.map((r) => r._id);
}

/**
 * MongoDB filter for the archive items (media, stories, events) a viewer may see.
 * - managers: everything that is not rejected;
 * - members: published items for the family or public, plus anything they added themselves;
 * - guests of public families: published public items that are not about anyone hidden from guests.
 */
export async function archiveVisibility(access: FamilyAccess, ownerField: 'uploadedBy' | 'createdBy', hasStatus = true): Promise<Record<string, unknown>> {
  const base: Record<string, unknown> = { familyId: access.familyId, deletedAt: null };
  const published = hasStatus ? { status: 'published' } : {};
  if (isArchiveManager(access)) {
    return { ...base, ...(hasStatus ? { $or: [{ status: { $in: ['published', 'pending_approval'] } }, { [ownerField]: access.membership!.userId }] } : {}) };
  }
  if (access.membership) {
    return { ...base, $or: [{ ...published, privacy: { $in: ['family', 'public'] } }, { [ownerField]: access.membership.userId }] };
  }
  if (!access.isPublicFamily) return { ...base, _id: null };
  return { ...base, ...published, privacy: 'public', memberIds: { $nin: await guestHiddenMemberIds(access) } };
}

/** Person cards for the given ids, as the viewer may see them (people hidden from the viewer are left out). */
export async function peopleCards(access: FamilyAccess, ids: Types.ObjectId[]): Promise<Map<string, PersonCard>> {
  const unique = [...new Set(ids.map(String))].map((id) => new Types.ObjectId(id));
  const policy = new MemberPolicy(access);
  const rows = unique.length ? await FamilyMemberModel.find({ _id: { $in: unique }, familyId: access.familyId, deletedAt: null }) : [];
  return new Map(rows.filter((m) => policy.isVisible(m)).map((m) => [m.id as string, toPersonCard(m, policy)]));
}

export async function userNames(ids: (Types.ObjectId | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is Types.ObjectId => !!x).map(String))];
  const rows = unique.length ? await UserModel.find({ _id: { $in: unique } }, { displayName: 1 }).lean() : [];
  return new Map(rows.map((u) => [u._id.toString(), u.displayName]));
}

/** Checks that every id names a live person in this family. */
export async function assertPeople(access: FamilyAccess, ids: string[] | undefined, path = 'memberIds'): Promise<Types.ObjectId[]> {
  const unique = [...new Set(ids ?? [])];
  if (!unique.length) return [];
  const found = await FamilyMemberModel.countDocuments({ _id: { $in: unique }, familyId: access.familyId, deletedAt: null });
  if (found !== unique.length) throw new AppError('VALIDATION_FAILED', 'Some of these people are not in the family', [{ path, message: 'Unknown person' }]);
  return unique.map((id) => new Types.ObjectId(id));
}

export function searchTextOf(...parts: (string | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .slice(0, 5000);
}

/** One `$regex` condition per word, so "kofi wedding" finds items mentioning both. */
export function searchFilter(q: string | undefined): Record<string, unknown> {
  const words = searchTextOf(q).split(/\s+/).filter(Boolean).slice(0, 8);
  if (!words.length) return {};
  return { $and: words.map((w) => ({ searchText: { $regex: w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } })) };
}

/** Additions by people whose additions are checked first go to the review queue (ContributionsService). */
export interface ArchiveReviewQueue {
  fileArchiveItem(
    access: FamilyAccess,
    actor: Actor,
    input: { kind: 'media.attach' | 'story.create'; targetType: 'media' | 'story'; targetId: Types.ObjectId; memberIds: Types.ObjectId[]; note?: string; profileOf?: Types.ObjectId },
  ): Promise<Types.ObjectId>;
}
