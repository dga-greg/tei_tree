import type { PersonCard } from './members.js';
import type { ParentChildSubtype, PartnershipStatus, PartnershipSubtype, RelationshipType, VerificationState } from './relationships.js';

/** A person in a tree window, with how many relatives exist in total (loaded or not). */
export interface TreeNode extends PersonCard {
  childCount: number;
  parentCount: number;
  /** Maternal and paternal lines (own or inherited), for colouring the tree by lineage. */
  lineage: { maternal: string | null; paternal: string | null };
}

export interface TreeEdge {
  id: string;
  type: RelationshipType;
  /** parent_child: parent; partnership: either partner. */
  from: string;
  /** parent_child: child; partnership: the other partner. */
  to: string;
  subtype: ParentChildSubtype | PartnershipSubtype;
  status: PartnershipStatus | null;
  verification: VerificationState;
}

/**
 * A bounded piece of the family graph. Clients merge windows as the user expands the tree;
 * the server never sends a whole large family at once.
 */
export interface TreeWindow {
  rootId: string | null;
  nodes: TreeNode[];
  edges: TreeEdge[];
  /** True when the window hit the node limit and some relatives were left out. */
  truncated: boolean;
}

export const TREE_MAX_DEPTH = 6;
export const TREE_NODE_LIMIT = 1500;

export interface BranchStats {
  descendantCount: number;
  generationSpan: number;
  livingCount: number;
  recalculatedAt: string | null;
}

export interface BranchView {
  id: string;
  familyId: string;
  name: string;
  description: string;
  history: string;
  founder: PersonCard | null;
  stats: BranchStats;
  createdAt: string;
}

export interface CreateBranchRequest {
  name: string;
  foundingMemberId: string;
  description?: string;
  history?: string;
}

export interface UpdateBranchRequest {
  name?: string;
  description?: string;
  history?: string;
}
