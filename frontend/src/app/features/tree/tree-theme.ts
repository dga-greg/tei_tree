/** Colours for the tree canvas. Set as SVG attributes (not CSS classes) so exported files are self-contained. */
export interface TreeTheme {
  surface: string;
  canvas: string;
  bandA: string;
  bandB: string;
  bandLabel: string;
  card: string;
  cardBorder: string;
  cardSelected: string;
  text: string;
  muted: string;
  avatar: string;
  avatarText: string;
  link: string;
  partner: string;
  living: string;
  disputed: string;
  toggle: string;
  toggleText: string;
}

export const TREE_LIGHT: TreeTheme = {
  surface: '#ffffff',
  canvas: '#fafaf9',
  bandA: '#f5f5f4',
  bandB: '#fafaf9',
  bandLabel: '#78716c',
  card: '#ffffff',
  cardBorder: '#d6d3d1',
  cardSelected: '#22563a',
  text: '#1c1917',
  muted: '#57534e',
  avatar: '#dcede1',
  avatarText: '#1d4530',
  link: '#57534e',
  partner: '#b07a06',
  living: '#2f7d52',
  disputed: '#b91c1c',
  toggle: '#22563a',
  toggleText: '#ffffff',
};

export const TREE_DARK: TreeTheme = {
  surface: '#1c1917',
  canvas: '#0c0a09',
  bandA: '#171412',
  bandB: '#0c0a09',
  bandLabel: '#a8a29e',
  card: '#1c1917',
  cardBorder: '#44403c',
  cardSelected: '#5ea47b',
  text: '#f5f5f4',
  muted: '#a8a29e',
  avatar: '#1d4530',
  avatarText: '#dcede1',
  link: '#a8a29e',
  partner: '#d4a017',
  living: '#3d9a66',
  disputed: '#f87171',
  toggle: '#3d9a66',
  toggleText: '#0c0a09',
};

/** Dash pattern per parent-child kind; partnerships are drawn as a double line instead. */
export function dashFor(subtype: string, verification: string): string | null {
  if (verification === 'disputed') return '3 5';
  if (subtype === 'adoptive') return '8 5';
  if (subtype === 'step' || subtype === 'foster' || subtype === 'guardian' || subtype === 'unknown') return '2 5';
  return verification === 'unverified' ? '6 4' : null;
}
