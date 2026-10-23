import { Router, type RequestHandler } from 'express';
import { requireAuth, requirePlatformPermission } from '../../middleware/authenticate.js';
import type { MembersController } from '../members/members.controller.js';
import type { RelationshipsController } from '../relationships/relationships.controller.js';
import type { GenerationsController } from '../generations/generations.controller.js';
import type { TreeController } from '../tree/tree.controller.js';
import type { BranchesController } from '../branches/branches.controller.js';
import type { KinshipController } from '../kinship/kinship.controller.js';
import type { ContributionsController } from '../contributions/contributions.controller.js';
import type { InvitationsController } from '../invitations/invitations.controller.js';
import type { CollaborationController } from './collaboration.controller.js';
import type { MediaController } from '../media/media.controller.js';
import type { StoriesController } from '../stories/stories.controller.js';
import type { EventsController } from '../events/events.controller.js';
import type { ExportController } from '../export/export.controller.js';
import type { LifecycleController } from '../lifecycle/lifecycle.controller.js';
import type { ImportController } from '../import/import.controller.js';
import type { DuplicatesController } from '../duplicates/duplicates.controller.js';
import type { NotificationsController } from '../notifications/notifications.controller.js';
import type { LineageController } from '../lineage/lineage.controller.js';
import type { FinanceController } from '../finance/finance.controller.js';
import type { PlacesController } from '../places/places.controller.js';
import type { BookController } from '../book/book.controller.js';
import type { AnnouncementsController } from '../announcements/announcements.controller.js';
import { loadFamilyAccess, requireFamilyPermission } from './family-access.js';
import type { FamiliesController } from './families.controller.js';

export function familiesRoutes(
  families: FamiliesController,
  members: MembersController,
  relationships: RelationshipsController,
  generations: GenerationsController,
  tree: TreeController,
  branches: BranchesController,
  kinship: KinshipController,
  contributions: ContributionsController,
  invitations: InvitationsController,
  collaboration: CollaborationController,
  more: {
    media: MediaController;
    stories: StoriesController;
    events: EventsController;
    uploadLimiter: RequestHandler;
    exports: ExportController;
    lifecycle: LifecycleController;
    imports: ImportController;
    duplicates: DuplicatesController;
    notifications: NotificationsController;
    lineage: LineageController;
    finance: FinanceController;
    places: PlacesController;
    books: BookController;
    announcements: AnnouncementsController;
  },
): Router {
  const router = Router();
  router.get('/', requireAuth, families.listMine);
  router.post('/', requireAuth, requirePlatformPermission('family.create'), families.create);
  // Families scheduled for deletion are closed (404) to the family routes below; their
  // administrators can list and restore them here.
  router.get('/scheduled-deletions', requireAuth, more.lifecycle.scheduledDeletions);
  router.delete('/:familyId/deletion', requireAuth, more.lifecycle.cancelFamilyDeletion);

  // Read routes serve guests for public families, so they do not require authentication;
  // write routes do, and each service re-checks the family permission for the target record.
  const family = Router({ mergeParams: true });
  family.use(loadFamilyAccess);
  family.get('/', requireFamilyPermission('family.view'), families.get);
  family.patch('/', requireAuth, families.update);
  family.put('/founder', requireAuth, families.setFounder);

  family.get('/members', requireFamilyPermission('member.view'), members.list);
  family.get('/members/search', requireFamilyPermission('member.view'), members.search);
  family.post('/members', requireAuth, members.create);
  family.get('/members/:memberId', requireFamilyPermission('member.view'), members.get);
  family.patch('/members/:memberId', requireAuth, members.update);
  family.delete('/members/:memberId', requireAuth, members.remove);

  // Must precede /relationships/:relationshipId.
  family.get('/relationships/between', requireAuth, kinship.between);
  family.post('/relationships', requireAuth, relationships.create);
  family.get('/relationships/:relationshipId', requireAuth, relationships.get);
  family.patch('/relationships/:relationshipId', requireAuth, relationships.update);
  family.delete('/relationships/:relationshipId', requireAuth, relationships.remove);

  // Generation statistics include counts of living people, so they are for members only.
  family.get('/dashboard', requireAuth, generations.dashboard);
  family.get('/generations', requireAuth, generations.summary);
  family.get('/generations/stats', requireAuth, generations.trend);
  family.get('/generations/conflicts', requireAuth, generations.conflicts);
  family.post('/generations/recalculate', requireAuth, generations.recalculate);
  family.put('/members/:memberId/generation-override', requireAuth, generations.setOverride);
  family.delete('/members/:memberId/generation-override', requireAuth, generations.clearOverride);

  // Tree windows: public families serve guests (only public people are included).
  family.get('/tree/root', requireFamilyPermission('member.view'), tree.root);
  family.get('/tree/nodes/:memberId/children', requireFamilyPermission('member.view'), tree.children);
  family.get('/tree/nodes/:memberId/descendants', requireFamilyPermission('member.view'), tree.descendants);
  family.get('/tree/nodes/:memberId/ancestors', requireFamilyPermission('member.view'), tree.ancestors);
  family.get('/tree/branches/:branchId', requireAuth, tree.branch);

  family.get('/branches', requireAuth, branches.list);
  family.post('/branches', requireAuth, branches.create);
  family.post('/branches/from-founder-children', requireAuth, branches.createForFounderChildren);
  family.get('/branches/:branchId', requireAuth, branches.get);
  family.patch('/branches/:branchId', requireAuth, branches.update);
  family.delete('/branches/:branchId', requireAuth, branches.remove);

  // Collaboration: proposals and their review.
  family.get('/contributions', requireAuth, contributions.list);
  family.post('/contributions', requireAuth, contributions.submit);
  family.post('/claims', requireAuth, contributions.claim);
  family.get('/contributions/:contributionId', requireAuth, contributions.get);
  family.post('/contributions/:contributionId/approve', requireAuth, contributions.approve);
  family.post('/contributions/:contributionId/reject', requireAuth, contributions.reject);
  family.post('/contributions/:contributionId/request-clarification', requireAuth, contributions.requestClarification);
  family.post('/contributions/:contributionId/respond', requireAuth, contributions.respond);
  family.post('/contributions/:contributionId/withdraw', requireAuth, contributions.withdraw);

  family.get('/invitations', requireAuth, invitations.list);
  family.post('/invitations', requireAuth, invitations.create);
  family.post('/invitations/:invitationId/resend', requireAuth, invitations.resend);
  family.delete('/invitations/:invitationId', requireAuth, invitations.revoke);

  family.get('/memberships', requireAuth, collaboration.listMemberships);
  family.patch('/memberships/:membershipId', requireAuth, collaboration.updateMembership);
  family.delete('/memberships/:membershipId', requireAuth, collaboration.removeMembership);
  family.delete('/memberships/:membershipId/profile', requireAuth, collaboration.unlinkProfile);
  family.post('/leave', requireAuth, collaboration.leave);

  family.get('/audit', requireAuth, collaboration.auditLog);
  family.post('/audit/:auditId/restore', requireAuth, collaboration.restore);
  family.get('/trash/members', requireAuth, collaboration.removedMembers);
  family.post('/trash/members/:memberId/restore', requireAuth, collaboration.restoreMember);

  // Archive: photos and documents, stories, events and the timeline. Reads serve guests of public
  // families (public items only); services filter every item by the viewer's role.
  const { media, stories, events, uploadLimiter, exports, lifecycle } = more;
  family.get('/media', requireFamilyPermission('member.view'), media.list);
  family.post('/media', requireAuth, uploadLimiter, media.upload);
  family.get('/media/:mediaId', requireFamilyPermission('member.view'), media.get);
  family.get('/media/:mediaId/content', requireFamilyPermission('member.view'), media.content);
  family.patch('/media/:mediaId', requireAuth, media.update);
  family.delete('/media/:mediaId', requireAuth, media.remove);
  family.put('/media/:mediaId/tags', requireAuth, media.tags);
  family.put('/media/:mediaId/transcript', requireAuth, media.transcript);
  family.post('/media/:mediaId/transcribe', requireAuth, uploadLimiter, media.transcribe);
  family.get('/trash/media', requireAuth, media.removed);
  family.post('/trash/media/:mediaId/restore', requireAuth, media.restore);

  family.get('/stories', requireFamilyPermission('member.view'), stories.list);
  family.post('/stories', requireAuth, stories.create);
  family.get('/stories/:storyId', requireFamilyPermission('member.view'), stories.get);
  family.patch('/stories/:storyId', requireAuth, stories.update);
  family.delete('/stories/:storyId', requireAuth, stories.remove);

  family.get('/timeline', requireFamilyPermission('member.view'), events.timeline);
  // Birthdays, remembrance days, anniversaries and dated events (members only).
  family.get('/calendar', requireAuth, more.notifications.calendarItems);
  // Lines through the mother and the father (abusua, ntoro, clans) and their totems.
  family.get('/lineages', requireFamilyPermission('member.view'), more.lineage.overview);

  // Places the family has lived, matched to people's and events' places (members).
  family.get('/places', requireAuth, more.places.overview);
  family.post('/places', requireAuth, more.places.create);
  family.get('/places/:placeId', requireAuth, more.places.detail);
  family.patch('/places/:placeId', requireAuth, more.places.update);
  family.delete('/places/:placeId', requireAuth, more.places.remove);
  // Printable family books (members; each person sees only the books they asked for).
  // Announcing ceremonies by SMS, WhatsApp, e-mail and app notification (organisers; checked per ceremony).
  family.get('/messaging', requireAuth, more.announcements.status);
  family.get('/events/:eventId/announcements', requireAuth, more.announcements.list);
  family.post('/events/:eventId/announcements/preview', requireAuth, more.announcements.preview);
  family.post('/events/:eventId/announcements', requireAuth, uploadLimiter, more.announcements.create);
  family.get('/announcements/:announcementId/recipients', requireAuth, more.announcements.recipients);
  family.get('/books', requireAuth, more.books.list);
  family.post('/books', requireAuth, uploadLimiter, more.books.create);
  family.get('/books/:bookId', requireAuth, more.books.get);
  family.get('/books/:bookId/download', requireAuth, more.books.download);
  family.delete('/books/:bookId', requireAuth, more.books.remove);

  // Family funds: dues and contributions (members; managed by administrators and treasurers).
  const { finance } = more;
  family.get('/funds', requireAuth, finance.list);
  family.post('/funds', requireAuth, finance.create);
  family.get('/funds/mine', requireAuth, finance.mine);
  family.get('/funds/:fundId', requireAuth, finance.get);
  family.patch('/funds/:fundId', requireAuth, finance.update);
  family.delete('/funds/:fundId', requireAuth, finance.remove);
  family.get('/funds/:fundId/contributions', requireAuth, finance.contributions);
  family.post('/funds/:fundId/contributions', requireAuth, finance.addContribution);
  family.patch('/funds/:fundId/contributions/:contributionId', requireAuth, finance.updateContribution);
  family.delete('/funds/:fundId/contributions/:contributionId', requireAuth, finance.removeContribution);
  family.get('/funds/:fundId/report', requireAuth, finance.report);
  family.get('/funds/:fundId/export', requireAuth, finance.csv);
  family.get('/events', requireFamilyPermission('member.view'), events.list);
  family.post('/events', requireAuth, events.create);
  family.get('/events/:eventId', requireFamilyPermission('member.view'), events.get);
  family.patch('/events/:eventId', requireAuth, events.update);
  family.delete('/events/:eventId', requireAuth, events.remove);

  // Data export and deletion of the whole family (administrators).
  family.get('/export', requireAuth, exports.family);
  family.post('/deletion', requireAuth, lifecycle.scheduleFamilyDeletion);

  // Bringing data in and keeping it clean (administrators): GEDCOM import, duplicates and merges.
  const { imports, duplicates } = more;
  family.post('/import/gedcom/preview', requireAuth, uploadLimiter, imports.preview);
  family.post('/import/gedcom', requireAuth, uploadLimiter, imports.commit);
  family.get('/imports', requireAuth, imports.list);
  family.post('/imports/:importId/undo', requireAuth, imports.undo);
  family.get('/duplicates', requireAuth, duplicates.list);
  family.post('/duplicates/dismiss', requireAuth, duplicates.dismiss);
  family.post('/members/:memberId/merge', requireAuth, duplicates.merge);
  family.get('/merges', requireAuth, duplicates.merges);
  family.post('/merges/:mergeId/undo', requireAuth, duplicates.undo);

  router.use('/:familyId', family);
  return router;
}
