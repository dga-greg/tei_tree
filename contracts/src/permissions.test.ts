import { describe, expect, it } from 'vitest';
import { canFamily, canPlatform, canPropose, FAMILY_PERMISSIONS, familyGrant } from './permissions.js';

describe('family permission matrix', () => {
  it('gives administrators every family permission except guest-only ones', () => {
    for (const p of FAMILY_PERMISSIONS) {
      if (p === 'invitation.request') continue;
      expect(canFamily({ role: 'family_admin' }, p), p).toBe(true);
    }
  });

  it('never lets guests modify anything', () => {
    for (const p of FAMILY_PERMISSIONS) {
      const grant = familyGrant('guest', p);
      if (p === 'invitation.request') expect(grant).toBe('full');
      else expect([null, 'public']).toContain(grant);
    }
  });

  it('lets guests view only public data', () => {
    expect(canFamily({ role: 'guest' }, 'member.view', { isPublic: false })).toBe(false);
    expect(canFamily({ role: 'guest' }, 'member.view', { isPublic: true })).toBe(true);
  });

  it('routes member edits by ordinary members through contributions', () => {
    const ctx = { role: 'family_member' as const };
    expect(canFamily(ctx, 'member.update')).toBe(false);
    expect(canPropose(ctx, 'member.update')).toBe(true);
    expect(canPropose(ctx, 'family.update')).toBe(false);
    expect(canPropose({ role: 'guest' }, 'member.update')).toBe(false);
  });

  it('restricts moderators to their assigned branches', () => {
    const scoped = { role: 'family_moderator' as const, moderatedBranchIds: ['b1'] };
    expect(canFamily(scoped, 'contribution.review', { branchIds: ['b1', 'b2'] })).toBe(true);
    expect(canFamily(scoped, 'contribution.review', { branchIds: ['b2'] })).toBe(false);
    expect(canFamily(scoped, 'contribution.review', {})).toBe(false);
    const unscoped = { role: 'family_moderator' as const, moderatedBranchIds: [] };
    expect(canFamily(unscoped, 'contribution.review', { branchIds: ['b9'] })).toBe(true);
    expect(canFamily(unscoped, 'membership.manage')).toBe(false);
  });

  it('limits ordinary members to their own private data and uploads', () => {
    const ctx = { role: 'family_member' as const };
    expect(canFamily(ctx, 'member.view_private', { ownedByViewer: false })).toBe(false);
    expect(canFamily(ctx, 'member.view_private', { ownedByViewer: true })).toBe(true);
    expect(canFamily(ctx, 'media.delete', { ownedByViewer: true })).toBe(true);
  });
});

describe('platform permission matrix', () => {
  it('reserves platform administration for super administrators', () => {
    expect(canPlatform('super_admin', 'platform.users.manage')).toBe(true);
    expect(canPlatform('user', 'platform.users.manage')).toBe(false);
    expect(canPlatform('user', 'family.create')).toBe(true);
  });
});
