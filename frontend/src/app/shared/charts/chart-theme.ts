/**
 * Chart colours, validated with the dataviz palette checker for both themes:
 * living / unknown / deceased in that fixed order (adjacent CVD ΔE ≥ 20 light and dark).
 * The light-mode gold is below 3:1 against the surface, so every chart that uses it ships a
 * table view alongside.
 */
export interface ChartTheme {
  living: string;
  unknown: string;
  deceased: string;
  single: string;
  surface: string;
  text: string;
  muted: string;
  grid: string;
}

export const LIGHT: ChartTheme = {
  living: '#2f7d52',
  unknown: '#2a78d6',
  deceased: '#c98500',
  single: '#2f7d52',
  surface: '#ffffff',
  text: '#1c1917',
  muted: '#57534e',
  grid: '#e7e5e4',
};

export const DARK: ChartTheme = {
  living: '#3d9a66',
  unknown: '#3987e5',
  deceased: '#c98500',
  single: '#3d9a66',
  surface: '#1c1917',
  text: '#f5f5f4',
  muted: '#a8a29e',
  grid: '#292524',
};
