import { createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import type { BookLabels, PaperSize } from '@fh/contracts';

/** Everything printed, already filtered to what the person asking may see. */
export interface BookPerson {
  id: string;
  name: string;
  lifespan: string;
  generation: number | null;
  /** Era of birth ("Gen X"), in the book's language; empty when not known or not shown. */
  era: string;
  born: string;
  died: string;
  hometown: string;
  parents: string[];
  partners: string[];
  children: string[];
  occupations: string[];
  education: string[];
  biography: string;
  photo: Buffer | null;
  stories: { id: string; title: string }[];
}

export interface BookData {
  familyName: string;
  title: string;
  subtitle: string;
  madeOn: string;
  rootId: string | null;
  /** In printing order. */
  people: BookPerson[];
  stories: { id: string; title: string; byline: string; text: string }[];
  timeline: { date: string; text: string }[];
  photos: { image: Buffer; caption: string }[];
  include: { tree: boolean; people: boolean; stories: boolean; timeline: boolean; photos: boolean };
  livingNote: boolean;
  labels: BookLabels;
  paper: PaperSize;
  language: string;
}

const FONTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'fonts');
const C = {
  brand: '#22563a',
  brandDark: '#14532d',
  brandSoft: '#dcede1',
  brandTint: '#f0f7f2',
  gold: '#d4a017',
  goldDark: '#8f6a0c',
  goldSoft: '#fbf1d3',
  ink: '#1c1917',
  body: '#44403c',
  muted: '#78716c',
  rule: '#e7e5e4',
  line: '#5ea47b',
};
/** Accent of each generation in the tree, as in the app: gold for the first, then greens. */
const GENERATION = [C.gold, '#22563a', '#2b6c48', '#3d875d', '#5ea47b', '#8ec3a2'];
const generationColour = (g: number | null) => (g ? GENERATION[(g - 1) % GENERATION.length]! : C.muted);
/** Paragraphs are spaced by the layout; blank lines typed between them would double the gap. */
const paragraphs = (text: string) => text.replace(/\r/g, '').replace(/\n\s*\n+/g, '\n').trim();
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

const MARGIN = 56;
// Family tree boxes, before scaling to the page.
const NODE_W = 156;
const NODE_H = 66;
const H_GAP = 14;
const V_GAP = 38;
/** Below this the tree is split into charts that continue on later pages. */
const MIN_SCALE = 0.62;
const STACK_INDENT = 22;
const STACK_GAP = 10;

type Doc = PDFKit.PDFDocument;
/** An image embedded once (PDFKit's openImage), drawn as often as needed. */
interface Embedded {
  width: number;
  height: number;
}
interface TreeNode {
  person: BookPerson;
  children: TreeNode[];
  /** Descendants not drawn in this chart (they get a chart of their own). */
  hidden: number;
  /** Children without children of their own, drawn in a column under the person to save width. */
  stacked: boolean;
  width: number;
  /** Centre of the box. */
  x: number;
  /** Top of the box. */
  y: number;
}

/**
 * Lays the book out with PDFKit. Pages are buffered so the contents page and the running footers can be written
 * at the end, when every page number is known. People link to their entries (internal PDF links).
 */
export async function renderBook(data: BookData, file: string, onProgress: (fraction: number) => void = () => {}): Promise<{ pages: number }> {
  const doc = new PDFDocument({ size: data.paper, margins: { top: MARGIN, bottom: 70, left: MARGIN, right: MARGIN }, bufferPages: true, autoFirstPage: false, lang: data.language, info: { Title: data.title, Subject: data.subtitle, Creator: 'Family Heritage' } });
  doc.registerFont('serif', join(FONTS, 'NotoSerif-Regular.ttf'));
  doc.registerFont('serif-bold', join(FONTS, 'NotoSerif-Bold.ttf'));
  doc.registerFont('serif-italic', join(FONTS, 'NotoSerif-Italic.ttf'));
  doc.registerFont('sans', join(FONTS, 'NotoSans-Regular.ttf'));
  doc.registerFont('sans-bold', join(FONTS, 'NotoSans-SemiBold.ttf'));
  const done = new Promise<void>((resolve, reject) => {
    const out = createWriteStream(file);
    out.on('finish', resolve).on('error', reject);
    doc.pipe(out);
  });

  const L = data.labels;
  const byId = new Map(data.people.map((p) => [p.id, p]));
  const width = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const left = () => doc.page.margins.left;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const pageIndex = () => doc.bufferedPageRange().start + doc.bufferedPageRange().count - 1;
  const chapters: { title: string; page: number }[] = [];
  const personPage = new Map<string, number>();
  const dest = (id: string) => `person-${id}`;
  const personLink = (id: string) => (byId.has(id) && data.include.people ? { goTo: dest(id) } : {});
  const ensure = (space: number) => {
    if (doc.y + space > bottom()) doc.addPage();
  };

  // Each photo is embedded once, however often it is printed.
  const images = new Map<string, Embedded | null>();
  const imageOf = (p: BookPerson) => {
    if (!p.photo) return null;
    if (!images.has(p.id)) {
      try {
        images.set(p.id, (doc as Doc & { openImage(src: Buffer): Embedded }).openImage(p.photo));
      } catch {
        images.set(p.id, null);
      }
    }
    return images.get(p.id)!;
  };
  /** A round portrait, or the initials when there is no photo. */
  const portrait = (p: BookPerson, x: number, y: number, size: number) => {
    const img = imageOf(p);
    const r = size / 2;
    if (img) {
      doc.save();
      doc.circle(x + r, y + r, r).clip();
      const scale = Math.max(size / img.width, size / img.height);
      doc.image(img as unknown as PDFKit.Mixins.ImageSrc, x + r - (img.width * scale) / 2, y + r - (img.height * scale) / 2, { width: img.width * scale, height: img.height * scale });
      doc.restore();
      doc.circle(x + r, y + r, r).lineWidth(1).strokeColor('#ffffff').stroke();
    } else {
      doc.circle(x + r, y + r, r).fill(C.brandSoft);
      const initials = p.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
      doc.fillColor(C.brand).font('sans-bold').fontSize(size * 0.36).text(initials, x, y + r - size * 0.25, { width: size, align: 'center', lineBreak: false });
    }
  };
  const smallCaps = (text: string, x: number, y: number, w: number, colour = C.muted, size = 7.5) =>
    doc.fillColor(colour).font('sans-bold').fontSize(size).text(text.toUpperCase(), x, y, { width: w, characterSpacing: 1.2 });

  const chapter = (title: string, layout: 'portrait' | 'landscape' = 'portrait') => {
    doc.addPage({ layout });
    chapters.push({ title, page: pageIndex() });
    doc.rect(left(), doc.page.margins.top, 40, 3.5).fill(C.gold);
    doc.fillColor(C.ink).font('serif-bold').fontSize(26).text(title, left(), doc.page.margins.top + 14, { width: width() });
    doc.moveDown(0.9);
  };

  // ---------------------------------------------------------------- cover
  doc.addPage();
  {
    const W = doc.page.width;
    const H = doc.page.height;
    const split = H * 0.64;
    doc.rect(0, 0, W, split).fill(C.brand);
    doc.rect(0, split, W, 5).fill(C.gold);
    drawCoverTree(doc, W - 250, 96, 210);
    let y = 150;
    if (data.familyName.trim().toLowerCase() !== data.title.trim().toLowerCase()) {
      doc.fillColor(C.gold).font('sans-bold').fontSize(10.5).text(data.familyName.toUpperCase(), 64, y, { characterSpacing: 2.5, width: W - 330 });
      y = doc.y + 10;
    }
    doc.fillColor('#ffffff').font('serif-bold').fontSize(40).text(data.title, 64, y, { width: W - 320, lineGap: 2 });
    if (data.subtitle) doc.moveDown(0.4).font('serif-italic').fontSize(16).fillColor(C.brandSoft).text(data.subtitle, 64, doc.y, { width: W - 320 });
    // Generation bands, as in the app: one, then three, six and eleven.
    const bandsTop = split - 96;
    [1, 3, 6, 11].forEach((n, row) => {
      const gap = 5;
      const w = (W - 128 - gap * (n - 1)) / n;
      for (let i = 0; i < n; i++) doc.roundedRect(64 + i * (w + gap), bandsTop + row * 16, w, 7, 3.5).fill(row === 0 ? C.gold : row === 1 ? '#8ec3a2' : row === 2 ? '#5ea47b' : '#3d875d');
    });
    if (data.people.length) {
      doc.fillColor(C.brand).font('serif-bold').fontSize(30).text(String(data.people.length), 64, split + 48, { width: 200 });
      smallCaps(L.people, 64, split + 88, 200);
    }
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor(C.muted).font('sans').fontSize(9.5).text(data.madeOn, 64, H - 100, { width: W - 128, lineBreak: false });
    if (data.livingNote) doc.text(L.livingNote, 64, H - 84, { width: W - 128, lineBreak: false });
    doc.page.margins.bottom = keep;
  }

  // ---------------------------------------------------------------- contents (filled in at the end)
  doc.addPage();
  const contentsPage = pageIndex();

  // ---------------------------------------------------------------- family tree
  const root = data.rootId ? byId.get(data.rootId) : undefined;
  if (data.include.tree && root) {
    chapter(L.familyTree, 'landscape');
    const drawn = new Set<string>();
    const queue: BookPerson[] = [root];
    let first = true;
    while (queue.length) {
      const start = queue.shift()!;
      const chart = layoutChart(start, byId, drawn, doc.page.width - 2 * MARGIN, (first ? bottom() - doc.y : bottom() - doc.page.margins.top) - 30);
      const height = chart.height * chart.scale;
      // Small charts share a page; each new one has its person's name above it.
      if (!first) {
        if (doc.y + height + 40 > bottom() || doc.page.layout !== 'landscape') doc.addPage({ layout: 'landscape' });
        else doc.y += 18;
        doc.addNamedDestination(`tree-${start.id}`);
        smallCaps(start.name, left(), doc.y, width(), generationColour(start.generation), 9);
        doc.y += 16;
      }
      const top = doc.y;
      const offsetX = left() + (width() - chart.width * chart.scale) / 2;
      drawChart(doc, chart.root, offsetX, top, chart.scale, L, personLink, portrait, (id) => byId.get(id)?.name);
      doc.y = top + height + 6;
      queue.push(...chart.continued);
      first = false;
    }
  }

  // ---------------------------------------------------------------- people
  if (data.include.people) {
    chapter(L.people);
    data.people.forEach((p, i) => {
      if (i > 0) {
        ensure(120);
        if (doc.y > doc.page.margins.top + 4) {
          doc.y += 10;
          doc.moveTo(left(), doc.y).lineTo(left() + width(), doc.y).lineWidth(0.6).strokeColor(C.rule).stroke();
          doc.y += 20;
        }
      }
      personEntry(p);
      if (i % 20 === 0) onProgress((i + 1) / Math.max(1, data.people.length));
    });
  }

  function personEntry(p: BookPerson) {
    const photoSize = p.photo ? 92 : 0;
    const textX = left() + (photoSize ? photoSize + 20 : 0);
    const textW = width() - (photoSize ? photoSize + 20 : 0);
    const colGap = 24;
    const colW = (textW - colGap) / 2;
    const names = (ids: string[]) => ids.filter((x) => byId.has(x));
    const columnA: [string, string | string[]][] = [
      [L.born, p.born],
      [L.died, p.died],
      [L.hometown, p.hometown],
      [L.work, p.occupations.join('\n')],
      [L.education, p.education.join('\n')],
    ];
    const columnB: [string, string | string[]][] = [
      [L.parents, names(p.parents)],
      [L.partners, names(p.partners)],
      [L.children, names(p.children)],
    ];
    const present = (f: [string, string | string[]]) => (Array.isArray(f[1]) ? f[1].length > 0 : !!f[1]);
    const a = columnA.filter(present);
    const b = columnB.filter(present);
    // Without a second column, the first spreads over both.
    const [colA, colB] = a.length && b.length ? [a, b] : [[...a, ...b], []];
    const colAW = colB.length ? colW : textW;
    const measure = (col: [string, string | string[]][], w: number) =>
      col.reduce((h, [, v]) => {
        doc.font('sans').fontSize(10);
        const lines = Array.isArray(v) ? v.map((id) => byId.get(id)!.name) : [v];
        return h + 12 + lines.reduce((s, line) => s + doc.heightOfString(line, { width: w }), 0) + 8;
      }, 0);
    doc.font('serif-bold').fontSize(20);
    const nameH = doc.heightOfString(p.name, { width: textW });
    const headH = (p.generation || p.era ? 14 : 0) + nameH + (p.lifespan ? 18 : 0) + 10;
    const blockH = Math.max(photoSize, headH + Math.max(measure(colA, colAW), measure(colB, colW)));
    ensure(Math.min(blockH, bottom() - doc.page.margins.top));

    const top = doc.y;
    personPage.set(p.id, pageIndex());
    doc.addNamedDestination(dest(p.id));
    if (photoSize) portrait(p, left(), top, photoSize);
    let y = top;
    const eyebrow = [p.generation ? fill(L.generation, { number: p.generation }) : '', p.era].filter(Boolean).join('  ·  ');
    if (eyebrow) {
      smallCaps(eyebrow, textX, y, textW, C.goldDark, 8);
      y += 14;
    }
    doc.fillColor(C.ink).font('serif-bold').fontSize(20).text(p.name, textX, y, { width: textW });
    y = doc.y;
    if (p.lifespan) {
      doc.fillColor(C.muted).font('serif-italic').fontSize(11).text(p.lifespan, textX, y + 1, { width: textW });
      y = doc.y;
    }
    y += 10;
    const column = (col: [string, string | string[]][], x: number, w: number) => {
      let cy = y;
      for (const [label, value] of col) {
        smallCaps(label, x, cy, w);
        cy = doc.y + 1;
        if (Array.isArray(value)) {
          for (const id of value) {
            doc.fillColor(C.brand).font('sans').fontSize(10).text(byId.get(id)!.name, x, cy, { width: w, ...personLink(id) });
            cy = doc.y;
          }
        } else {
          doc.fillColor(C.ink).font('sans').fontSize(10).text(value, x, cy, { width: w });
          cy = doc.y;
        }
        cy += 8;
      }
      return cy;
    };
    const endA = column(colA, textX, colAW);
    const endB = colB.length ? column(colB, textX + colW + colGap, colW) : y;
    doc.y = Math.max(endA, endB, top + photoSize + 8);
    doc.x = left();

    if (p.biography) {
      doc.moveDown(0.3);
      doc.fillColor(C.body).font('serif').fontSize(10.5).text(paragraphs(p.biography), left(), doc.y, { width: width(), lineGap: 2.5, paragraphGap: 6 });
    }
    if (p.stories.length && data.include.stories) {
      doc.moveDown(0.6);
      ensure(30);
      smallCaps(L.stories, left(), doc.y, width());
      for (const s of p.stories) doc.fillColor(C.brand).font('serif-italic').fontSize(10.5).text(`— ${s.title}`, left(), doc.y + 1, { width: width(), goTo: `story-${s.id}` });
    }
    if (!p.biography && !colA.length && !colB.length) {
      doc.fillColor(C.muted).font('serif-italic').fontSize(10).text(L.noDetails, textX, doc.y, { width: textW });
    }
  }

  // ---------------------------------------------------------------- stories
  if (data.include.stories && data.stories.length) {
    chapter(L.stories);
    data.stories.forEach((s, i) => {
      if (i > 0) {
        ensure(140);
        doc.y += 14;
        doc.rect(left(), doc.y, 24, 2).fill(C.gold);
        doc.y += 16;
      }
      doc.addNamedDestination(`story-${s.id}`);
      doc.fillColor(C.ink).font('serif-bold').fontSize(16).text(s.title, left(), doc.y, { width: width() });
      if (s.byline) doc.fillColor(C.muted).font('serif-italic').fontSize(10).text(s.byline, { width: width() });
      doc.moveDown(0.5);
      doc.fillColor(C.body).font('serif').fontSize(11).text(paragraphs(s.text), left(), doc.y, { width: width(), lineGap: 3, paragraphGap: 7 });
    });
  }

  // ---------------------------------------------------------------- timeline
  if (data.include.timeline && data.timeline.length) {
    chapter(L.timeline);
    const dateW = 112;
    const rail = left() + dateW + 14;
    const textX = rail + 16;
    const textW = width() - (textX - left());
    data.timeline.forEach((e, i) => {
      doc.font('serif').fontSize(10.5);
      const h = Math.max(doc.heightOfString(e.text, { width: textW }), 14) + 12;
      ensure(h);
      const y = doc.y;
      // The rail joins this dot to the next one.
      if (i < data.timeline.length - 1) doc.moveTo(rail, y + 6.5).lineTo(rail, y + h + 6.5).lineWidth(1.5).strokeColor(C.brandSoft).stroke();
      doc.circle(rail, y + 6.5, 4).fill(C.brand);
      doc.fillColor(C.brand).font('sans-bold').fontSize(9).text(e.date, left(), y + 1.5, { width: dateW, align: 'right' });
      doc.fillColor(C.ink).font('serif').fontSize(10.5).text(e.text, textX, y, { width: textW });
      doc.y = y + h;
    });
  }

  // ---------------------------------------------------------------- photographs
  if (data.include.photos && data.photos.length) {
    chapter(L.photos);
    const cols = 2;
    const gap = 20;
    const cellW = (width() - gap) / cols;
    const cellH = 210;
    let slot = 0;
    let rowTop = doc.y;
    for (const ph of data.photos) {
      const col = slot % cols;
      if (col === 0 && slot > 0) rowTop += cellH + 50;
      if (rowTop + cellH + 44 > bottom()) {
        doc.addPage();
        rowTop = doc.page.margins.top;
      }
      const x = left() + col * (cellW + gap);
      doc.rect(x, rowTop, cellW, cellH).fill('#f5f5f4');
      try {
        doc.image(ph.image, x + 6, rowTop + 6, { fit: [cellW - 12, cellH - 12], align: 'center', valign: 'center' });
      } catch {
        /* an unreadable photo leaves its frame empty */
      }
      doc.fillColor(C.muted).font('sans').fontSize(8.5).text(ph.caption, x, rowTop + cellH + 7, { width: cellW, height: 36, ellipsis: true });
      slot++;
    }
  }

  // ---------------------------------------------------------------- index
  if (data.include.people && data.people.length) {
    chapter(L.index);
    const sorted = [...data.people].sort((a, b) => a.name.localeCompare(b.name, data.language));
    const gap = 28;
    const colW = (width() - gap) / 2;
    let col = 0;
    let y = doc.y;
    let columnTop = doc.y;
    let letter = '';
    for (const p of sorted) {
      const initial = p.name.charAt(0).toLocaleUpperCase(data.language);
      const need = initial !== letter ? 34 : 15;
      if (y + need > bottom()) {
        if (col === 0) {
          col = 1;
          y = columnTop;
        } else {
          doc.addPage();
          col = 0;
          y = columnTop = doc.page.margins.top;
        }
      }
      const x = left() + col * (colW + gap);
      if (initial !== letter) {
        letter = initial;
        doc.fillColor(C.gold).font('serif-bold').fontSize(13).text(letter, x, y + 4, { width: colW, lineBreak: false });
        y += 20;
      }
      const page = String((personPage.get(p.id) ?? 0) + 1);
      doc.font('sans').fontSize(9.5);
      const nameW = Math.min(doc.widthOfString(p.name), colW - 40);
      doc.fillColor(C.ink).text(p.name, x, y, { width: colW - 36, lineBreak: false, ellipsis: true, height: 13, goTo: dest(p.id) });
      dots(doc, x + nameW + 4, x + colW - 30, y + 9.5);
      doc.fillColor(C.muted).text(page, x + colW - 28, y, { width: 28, align: 'right', lineBreak: false });
      y += 15;
    }
  }

  // ---------------------------------------------------------------- contents and footers, now that pages are known
  doc.switchToPage(contentsPage);
  doc.rect(left(), doc.page.margins.top, 40, 3.5).fill(C.gold);
  doc.fillColor(C.ink).font('serif-bold').fontSize(26).text(L.contents, left(), doc.page.margins.top + 14);
  doc.moveDown(1.2);
  chapters.forEach((c, i) => {
    const y = doc.y;
    doc.fillColor(C.gold).font('sans-bold').fontSize(10).text(String(i + 1).padStart(2, '0'), left(), y + 3, { width: 28, lineBreak: false });
    doc.fillColor(C.ink).font('serif').fontSize(14);
    const titleW = doc.widthOfString(c.title);
    doc.text(c.title, left() + 32, y, { width: width() - 92, lineBreak: false });
    dots(doc, left() + 36 + titleW, left() + width() - 40, y + 13);
    doc.fillColor(C.muted).font('sans').fontSize(11).text(String(c.page + 1), left() + width() - 36, y + 2, { width: 36, align: 'right', lineBreak: false });
    doc.y = y + 30;
  });
  const range = doc.bufferedPageRange();
  for (let i = range.start + 1; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 42;
    doc.moveTo(left(), y - 9).lineTo(doc.page.width - doc.page.margins.right, y - 9).lineWidth(0.5).strokeColor(C.rule).stroke();
    doc.fillColor(C.muted).font('sans').fontSize(8).text(data.title, left(), y, { width: width() / 2, lineBreak: false, ellipsis: true, height: 10 });
    doc.text(fill(L.page, { number: i + 1 }), left() + width() / 2, y, { width: width() / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = keep;
  }
  const pages = range.count;
  doc.flushPages();
  doc.end();
  await done;
  onProgress(1);
  return { pages };
}

/** A dotted leader between a title and its page number. */
function dots(doc: Doc, from: number, to: number, y: number) {
  if (to - from < 8) return;
  doc.save();
  doc.moveTo(from, y).lineTo(to, y).lineWidth(0.8).dash(0.8, { space: 3 }).strokeColor('#a8a29e').stroke();
  doc.undash();
  doc.restore();
}

/**
 * The tree from `start` down, as deep as fits the page at a readable size. People whose descendants do not fit
 * are returned in `continued`: each gets a chart of its own.
 */
function layoutChart(start: BookPerson, byId: Map<string, BookPerson>, drawn: Set<string>, maxW: number, maxH: number) {
  const build = (p: BookPerson, depth: number, limit: number, seen: Set<string>): TreeNode => {
    seen.add(p.id);
    const kids = p.children.map((id) => byId.get(id)).filter((c): c is BookPerson => !!c && !seen.has(c.id) && !drawn.has(c.id));
    const children = depth + 1 < limit ? kids.map((c) => build(c, depth + 1, limit, seen)) : [];
    const node: TreeNode = { person: p, children, hidden: 0, stacked: false, width: 0, x: 0, y: 0 };
    if (!children.length && kids.length) node.hidden = kids.reduce((n, c) => n + countDescendants(c, byId, seen), 0);
    node.stacked = children.length > 1 && children.every((c) => !c.children.length && !c.hidden);
    node.width = node.stacked ? NODE_W + STACK_INDENT : Math.max(NODE_W, children.reduce((w, c) => w + c.width, 0) + H_GAP * Math.max(0, children.length - 1));
    return node;
  };
  const depthOf = (n: TreeNode): number => 1 + Math.max(0, ...n.children.map(depthOf));
  /** Height of the subtree from the top of its box. */
  const heightOf = (n: TreeNode): number =>
    n.stacked ? NODE_H + 16 + n.children.length * (NODE_H + STACK_GAP) - STACK_GAP : NODE_H + (n.children.length ? V_GAP + Math.max(...n.children.map(heightOf)) : 0);
  const fit = (n: TreeNode) => {
    const height = heightOf(n);
    return { height, scale: Math.min(1, maxW / n.width, maxH / height) };
  };

  // As many generations as stay readable; at least the person and their children.
  let limit = 2;
  let tree = build(start, 0, limit, new Set());
  for (let next = 3; next <= 40; next++) {
    const candidate = build(start, 0, next, new Set());
    if (depthOf(candidate) < next || fit(candidate).scale < MIN_SCALE) {
      if (depthOf(candidate) < next && fit(candidate).scale >= MIN_SCALE) tree = candidate;
      break;
    }
    tree = candidate;
    limit = next;
  }
  const place = (n: TreeNode, x: number, y: number) => {
    n.y = y;
    if (n.stacked) {
      n.x = x + NODE_W / 2;
      n.children.forEach((c, i) => {
        c.x = x + STACK_INDENT + NODE_W / 2;
        c.y = y + NODE_H + 16 + i * (NODE_H + STACK_GAP);
      });
      return;
    }
    n.x = x + n.width / 2;
    const inner = n.children.reduce((w, c) => w + c.width, 0) + H_GAP * Math.max(0, n.children.length - 1);
    let cx = x + (n.width - inner) / 2;
    for (const c of n.children) {
      place(c, cx, y + NODE_H + V_GAP);
      cx += c.width + H_GAP;
    }
  };
  place(tree, 0, 0);
  const continued: BookPerson[] = [];
  const mark = (n: TreeNode) => {
    drawn.add(n.person.id);
    if (n.hidden) continued.push(n.person);
    n.children.forEach(mark);
  };
  mark(tree);
  const { height, scale } = fit(tree);
  return { root: tree, width: tree.width, height, scale, continued };
}

function countDescendants(p: BookPerson, byId: Map<string, BookPerson>, seen: Set<string>): number {
  const counted = new Set<string>();
  const stack = [p.id];
  while (stack.length) {
    const id = stack.pop()!;
    if (counted.has(id) || seen.has(id)) continue;
    counted.add(id);
    for (const c of byId.get(id)?.children ?? []) if (byId.has(c)) stack.push(c);
  }
  return counted.size;
}

function drawChart(
  doc: Doc,
  root: TreeNode,
  offsetX: number,
  offsetY: number,
  scale: number,
  L: BookLabels,
  personLink: (id: string) => { goTo?: string },
  portrait: (p: BookPerson, x: number, y: number, size: number) => void,
  nameOf: (id: string) => string | undefined,
) {
  doc.save();
  doc.translate(offsetX, offsetY);
  doc.scale(scale);
  const lines = (n: TreeNode) => {
    if (!n.children.length) return;
    doc.lineWidth(1.4).strokeColor(C.line);
    if (n.stacked) {
      // A rail down the left of the column, with a tick to each child.
      const railX = n.x - NODE_W / 2 + STACK_INDENT / 2;
      const last = n.children[n.children.length - 1]!;
      doc.moveTo(railX, n.y + NODE_H).lineTo(railX, last.y + NODE_H / 2).stroke();
      for (const c of n.children) doc.moveTo(railX, c.y + NODE_H / 2).lineTo(c.x - NODE_W / 2, c.y + NODE_H / 2).stroke();
      return;
    }
    const bus = n.y + NODE_H + V_GAP / 2;
    doc.moveTo(n.x, n.y + NODE_H).lineTo(n.x, bus).stroke();
    if (n.children.length > 1) doc.moveTo(n.children[0]!.x, bus).lineTo(n.children[n.children.length - 1]!.x, bus).stroke();
    for (const c of n.children) {
      doc.moveTo(c.x, bus).lineTo(c.x, c.y).stroke();
      lines(c);
    }
  };
  lines(root);
  const box = (n: TreeNode) => {
    const p = n.person;
    const x = n.x - NODE_W / 2;
    const y = n.y;
    const accent = generationColour(p.generation);
    doc.roundedRect(x, y, NODE_W, NODE_H, 7).lineWidth(0.8).fillAndStroke('#ffffff', '#d6d3d1');
    doc.save();
    doc.roundedRect(x, y, NODE_W, NODE_H, 7).clip();
    doc.rect(x, y, 4.5, NODE_H).fill(accent);
    doc.restore();
    const photo = 30;
    portrait(p, x + 11, y + 9, photo);
    const tx = x + 11 + photo + 8;
    const tw = NODE_W - (tx - x) - 8;
    if (p.generation) doc.fillColor(accent === C.gold ? C.goldDark : accent).font('sans-bold').fontSize(6.5).text(`G${p.generation}`, x + NODE_W - 24, y + 6, { width: 18, align: 'right', lineBreak: false });
    doc.fillColor(C.ink).font('sans-bold').fontSize(8.6).text(p.name, tx, y + 9, { width: tw - 10, height: 22, ellipsis: true, lineGap: -1, ...personLink(p.id) });
    let ty = Math.max(doc.y, y + 21);
    if (p.lifespan) {
      doc.fillColor(C.muted).font('sans').fontSize(6.8).text(p.lifespan, tx, ty, { width: tw, height: 9, ellipsis: true, lineBreak: false });
      ty += 10;
    }
    const partners = p.partners.map(nameOf).filter(Boolean);
    if (partners.length && ty < y + NODE_H - 10) {
      doc.fillColor(C.brand).font('sans').fontSize(6.8).text(`${L.married} ${partners.join(', ')}`, tx, ty, { width: tw, height: 9, ellipsis: true, lineBreak: false });
      ty += 10;
    }
    if (n.hidden) {
      doc.fillColor(C.goldDark).font('sans-bold').fontSize(6.5).text(`${fill(L.moreChildren, { count: n.hidden })} →`, x + 11, y + NODE_H - 13, { width: NODE_W - 20, height: 9, ellipsis: true, lineBreak: false, goTo: `tree-${p.id}` });
    }
    for (const c of n.children) box(c);
  };
  box(root);
  doc.restore();
}

/** A small stylised tree for the cover. */
function drawCoverTree(doc: Doc, x: number, y: number, size: number) {
  const cx = x + size / 2;
  doc.save();
  doc.opacity(0.9);
  doc.lineCap('round').strokeColor('#a57c12');
  doc.lineWidth(size * 0.07).moveTo(cx, y + size * 1.25).bezierCurveTo(cx - 6, y + size, cx + 6, y + size * 0.85, cx, y + size * 0.62).stroke();
  const branch = (x1: number, y1: number, x2: number, y2: number, w: number) => doc.lineWidth(w).moveTo(x1, y1).quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 + 10, x2, y2).stroke();
  branch(cx, y + size * 0.75, cx - size * 0.32, y + size * 0.42, size * 0.035);
  branch(cx, y + size * 0.7, cx + size * 0.34, y + size * 0.4, size * 0.035);
  branch(cx, y + size * 0.62, cx - size * 0.05, y + size * 0.28, size * 0.03);
  const leaves: [number, number, number, string][] = [
    [-0.36, 0.38, 0.17, '#3d875d'], [0.36, 0.36, 0.17, '#3d875d'], [0, 0.2, 0.2, '#5ea47b'], [-0.2, 0.26, 0.16, '#8ec3a2'],
    [0.2, 0.24, 0.16, '#8ec3a2'], [-0.45, 0.5, 0.12, '#5ea47b'], [0.46, 0.48, 0.12, '#5ea47b'], [0, 0.42, 0.14, '#3d875d'],
  ];
  for (const [dx, dy, r, colour] of leaves) doc.circle(cx + dx * size, y + dy * size, r * size).fillOpacity(0.92).fill(colour);
  doc.fillOpacity(1);
  for (const [dx, dy] of [[-0.36, 0.38], [0.36, 0.36], [0, 0.2], [0, 0.42]] as const) {
    doc.circle(cx + dx * size, y + dy * size, size * 0.045).lineWidth(2).fillAndStroke(C.brandDark, C.gold);
  }
  doc.restore();
}
