// Draws public/images/auth-tree.svg, the tree on the sign-in pages: node scripts/draw-auth-tree.mjs > public/images/auth-tree.svg
// To use your own picture instead, replace that file (any SVG, PNG or JPG; keep the name or change it in auth-layout.component.ts).
// Draws a decorative family tree: a trunk that splits generation by generation, leaf clusters,
// and gold "people" medallions at the ends of branches. Deterministic, so the file is stable.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const f = (n) => Math.round(n * 10) / 10;
const branches = [], leaves = [], people = [], roots = [];
function grow(x, y, angle, len, width, depth) {
  const x2 = x + Math.cos(angle) * len, y2 = y - Math.sin(angle) * len;
  // gentle curve
  const bend = (rnd() - 0.5) * len * 0.35;
  const cx = (x + x2) / 2 + Math.sin(angle) * bend, cy = (y + y2) / 2 + Math.cos(angle) * bend;
  branches.push({ d: `M${f(x)} ${f(y)}Q${f(cx)} ${f(cy)} ${f(x2)} ${f(y2)}`, w: width });
  if (depth === 0) {
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2, r = 6 + rnd() * 22;
      leaves.push({ x: x2 + Math.cos(a) * r, y: y2 + Math.sin(a) * r, r: 9 + rnd() * 11, c: Math.floor(rnd() * 3) });
    }
    if (rnd() < 0.7 && people.every((p) => Math.hypot(p.x - x2, p.y - y2) > 40)) people.push({ x: x2, y: y2 });
    return;
  }
  const n = depth >= 4 ? 2 : 2 + (rnd() < 0.35 ? 1 : 0);
  const spread = depth >= 4 ? 0.6 : 0.85;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    const a = angle + t * spread * 2 * 0.62 + (rnd() - 0.5) * 0.22;
    // keep the crown rounded: pull branches near horizontal back up
    const aa = Math.min(Math.max(a, 0.35), Math.PI - 0.35);
    grow(x2, y2, aa, len * (0.76 + rnd() * 0.08), width * 0.66, depth - 1);
  }
}
grow(300, 560, Math.PI / 2, 105, 26, 5);
for (const [a, l] of [[-0.25, 90], [0.15, 70], [Math.PI + 0.25, 90], [Math.PI - 0.15, 70], [-Math.PI / 2 + 0.3, 50]]) {
  const x2 = 300 + Math.cos(a) * l, y2 = 560 - Math.sin(a) * l * 0.35 + 18;
  roots.push(`M300 552Q${f(300 + Math.cos(a) * l * 0.4)} ${f(568)} ${f(x2)} ${f(y2)}`);
}
const greens = ['#2b6c48', '#3d875d', '#5ea47b'];
const back = leaves.filter((_, i) => i % 2 === 0), front = leaves.filter((_, i) => i % 2 === 1);
const leaf = (l, o) => `<circle cx="${f(l.x)}" cy="${f(l.y)}" r="${f(l.r)}" fill="${greens[l.c]}" fill-opacity="${o}"/>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="50 130 500 465" role="img" aria-label="A family tree">
<g>${back.map((l) => leaf(l, 0.55)).join('')}</g>
<g fill="none" stroke="#a57c12" stroke-linecap="round">${roots.map((d) => `<path d="${d}" stroke-width="7" stroke-opacity="0.7"/>`).join('')}
${branches.map((b) => `<path d="${b.d}" stroke-width="${f(b.w)}"/>`).join('')}</g>
<g>${front.map((l) => leaf(l, 0.85)).join('')}</g>
<g>${people.map((p) => `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="11" fill="#0b2516" stroke="#f0cf6b" stroke-width="3"/><circle cx="${f(p.x)}" cy="${f(p.y - 3)}" r="3.4" fill="#f0cf6b"/><path d="M${f(p.x - 5.5)} ${f(p.y + 6)}a5.5 5 0 0 1 11 0" fill="#f0cf6b"/>`).join('')}</g>
<ellipse cx="300" cy="580" rx="170" ry="9" fill="#3d875d" fill-opacity="0.25"/>
</svg>
`;
process.stdout.write(svg);
