import { Router, type RequestHandler } from 'express';
import { requireAuth, requirePlatformPermission } from '../../middleware/authenticate.js';
import type { MembersController } from '../members/members.controller.js';
import type { RelationshipsController } from '../relationships/relationships.controller.js';
import type { GenerationsController } from '../generations/generations.controller.js';
import type { TreeController } from '../tree/tree.controller.js';
import type { MediaController } from '../media/media.controller.js';
import { loadFamilyAccess, requireFamilyPermission } from './family-access.js';
import type { FamiliesController } from './families.controller.js';

export function familiesRoutes(
  families: FamiliesController,
  members: MembersController,
  relationships: RelationshipsController,
  generations: GenerationsController,
  tree: TreeController,
  more: { media: MediaController; uploadLimiter: RequestHandler },
): Router {
  const router = Router();
  router.get('/', requireAuth, families.listMine);
  router.post('/', requireAuth, requirePlatformPermission('family.create'), families.create);

  // Read routes serve guests for public families, so they do not require authentication;
  // write routes do, and each service re-checks the family permission for the target record.
  const family = Router({ mergeParams: true });
  family.use(loadFamilyAccess);
  family.get('/', requireFamilyPermission('family.view'), families.get);
  family.patch('/', requireAuth, families.update);
  family.put('/founder', requireAuth, families.setFounder);

  family.get('/members', requireFamilyPermission('member.view'), members.list);
  family.get('/members/search', requireFamilyPermission('member.view'), members.search);
  family.get('/attribute-names', requireAuth, members.attributeNames);
  family.post('/members', requireAuth, members.create);
  family.get('/members/:memberId', requireFamilyPermission('member.view'), members.get);
  family.patch('/members/:memberId', requireAuth, members.update);
  family.delete('/members/:memberId', requireAuth, members.remove);

  family.post('/relationships', requireAuth, relationships.create);
  family.get('/relationships/:relationshipId', requireAuth, relationships.get);
  family.patch('/relationships/:relationshipId', requireAuth, relationships.update);
  family.delete('/relationships/:relationshipId', requireAuth, relationships.remove);

  // Figures for the dashboard include counts of living people, so they are for members only.
  family.get('/dashboard', requireAuth, generations.dashboard);
  family.post('/generations/recalculate', requireAuth, generations.recalculate);

  // Tree windows: public families serve guests (only public people are included).
  family.get('/tree/root', requireFamilyPermission('member.view'), tree.root);
  family.get('/tree/nodes/:memberId/children', requireFamilyPermission('member.view'), tree.children);
  family.get('/tree/nodes/:memberId/descendants', requireFamilyPermission('member.view'), tree.descendants);
  family.get('/tree/nodes/:memberId/ancestors', requireFamilyPermission('member.view'), tree.ancestors);

  // Pictures of people: uploaded as a person's photo and served through short-lived links.
  const { media, uploadLimiter } = more;
  family.post('/media', requireAuth, uploadLimiter, media.upload);
  family.get('/media/:mediaId/content', requireFamilyPermission('member.view'), media.content);

  router.use('/:familyId', family);
  return router;
}
