import { z } from 'zod';
import { displayName, type CalendarItem, type CalendarKind, type PersonCard } from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import { archiveVisibility } from '../archive/archive.shared.js';
import { FamilyEventModel } from '../events/event.model.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyMemberModel } from '../members/member.model.js';
import { toPersonCard } from '../members/member.mapper.js';
import { MemberPolicy } from '../members/member.policy.js';
import { RelationshipModel } from '../relationships/relationship.model.js';

/**
 * The family calendar: birthdays, remembrance days, wedding anniversaries and dated family events in a
 * range of days. Every date comes from what the viewer may see — a birthday appears only when the
 * viewer's own view of the profile includes the day and month (children's and hidden dates do not).
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;
const WEDDINGS = ['marriage', 'customary_marriage', 'civil_union'];
const STILL_MARRIED = ['current', 'widowed', 'unknown'];
/** People of unknown life status are reminded of only while plausibly alive. */
const BIRTHDAYS_UP_TO_AGE = 100;

export const calendarQuery = z
  .object({
    from: z.string().regex(DAY, 'Use YYYY-MM-DD'),
    to: z.string().regex(DAY, 'Use YYYY-MM-DD'),
  })
  .strict()
  .superRefine((q, ctx) => {
    const from = Date.parse(`${q.from}T00:00:00Z`);
    const to = Date.parse(`${q.to}T00:00:00Z`);
    if (Number.isNaN(from) || Number.isNaN(to)) ctx.addIssue({ code: 'custom', path: ['from'], message: 'Not a real date' });
    else if (to < from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Must not be before the start' });
    else if ((to - from) / 86_400_000 > MAX_DAYS) ctx.addIssue({ code: 'custom', path: ['to'], message: `At most ${MAX_DAYS} days at a time` });
  });

export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The days in [from, to] on which a yearly date (month, day) falls; 29 February is kept on the 28th in other years. */
export function yearlyDates(month: number, day: number, from: string, to: string): { date: string; year: number }[] {
  const out: { date: string; year: number }[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    const d = month === 2 && day === 29 && !isLeap(y) ? 28 : day;
    const date = `${y}-${pad(month)}-${pad(d)}`;
    if (date >= from && date <= to) out.push({ date, year: y });
  }
  return out;
}

export function itemTitle(kind: CalendarKind, names: string[], years: number | null, eventTitle = ''): string {
  const who = names.length === 2 ? `${names[0]} and ${names[1]}` : (names[0] ?? 'Someone');
  switch (kind) {
    case 'birthday':
      return years ? `${who}'s ${ordinal(years)} birthday` : `${who}'s birthday`;
    case 'birth_remembrance':
      return years ? `${who} would have turned ${years}` : `${who} was born on this day`;
    case 'remembrance':
      return years ? `Remembering ${who}, ${years} ${years === 1 ? 'year' : 'years'} since they passed` : `Remembering ${who}`;
    case 'anniversary':
      return years ? `${who}'s ${ordinal(years)} wedding anniversary` : `${who}'s wedding anniversary`;
    case 'event':
      return eventTitle;
  }
}

const exact = (d: { year?: number | null; month?: number | null; day?: number | null } | null | undefined) => !!d?.month && !!d.day;

export class CalendarService {
  /** Calendar days for one viewer; only family members see the calendar. */
  async items(access: FamilyAccess, from: string, to: string, kinds?: Set<CalendarKind>): Promise<CalendarItem[]> {
    if (!access.membership) throw AppError.forbidden('The calendar is for members of the family');
    const want = (k: CalendarKind) => !kinds || kinds.has(k);
    const policy = new MemberPolicy(access);
    const items: CalendarItem[] = [];
    const nowYear = new Date().getUTCFullYear();

    // People with a day and month of birth or death.
    const people = await FamilyMemberModel.find({
      familyId: access.familyId,
      deletedAt: null,
      $or: [{ 'birthDate.day': { $gte: 1 }, 'birthDate.month': { $gte: 1 } }, { 'deathDate.day': { $gte: 1 }, 'deathDate.month': { $gte: 1 } }],
    });
    const cards = new Map<string, PersonCard>();
    for (const m of people) {
      if (!policy.isVisible(m)) continue;
      const card = toPersonCard(m, policy);
      cards.set(m.id as string, card);
      const name = displayName(m);
      const born = card.birthDate;
      const died = card.deathDate;
      if (born && exact(born)) {
        const deceased = card.vitalStatus === 'deceased' || !!died;
        const kind: CalendarKind = deceased ? 'birth_remembrance' : 'birthday';
        if (want(kind)) {
          for (const { date, year } of yearlyDates(born.month!, born.day!, from, to)) {
            const years = born.year && born.qualifier === 'exact' ? year - born.year : null;
            if (years !== null && years < 0) continue;
            if (kind === 'birthday' && card.vitalStatus !== 'living' && (!born.year || nowYear - born.year > BIRTHDAYS_UP_TO_AGE)) continue;
            items.push({ date, kind, title: itemTitle(kind, [name], years || null), people: [card], years: years || null });
          }
        }
      }
      if (died && exact(died) && want('remembrance')) {
        for (const { date, year } of yearlyDates(died.month!, died.day!, from, to)) {
          const years = died.year && died.qualifier === 'exact' ? year - died.year : null;
          if (years !== null && years < 0) continue;
          items.push({ date, kind: 'remembrance', title: itemTitle('remembrance', [name], years || null), people: [card], years: years || null });
        }
      }
    }

    // Wedding anniversaries of couples both of whose profiles the viewer sees in full.
    if (want('anniversary')) {
      const couples = await RelationshipModel.find({
        familyId: access.familyId,
        deletedAt: null,
        type: 'partnership',
        subtype: { $in: WEDDINGS },
        status: { $in: STILL_MARRIED },
        'startDate.day': { $gte: 1 },
        'startDate.month': { $gte: 1 },
      }).lean();
      const ids = couples.flatMap((c) => [c.personA, c.personB]);
      const partners = ids.length ? await FamilyMemberModel.find({ _id: { $in: ids }, familyId: access.familyId, deletedAt: null }) : [];
      const byId = new Map(partners.map((p) => [p.id as string, p]));
      for (const c of couples) {
        const a = byId.get(c.personA.toString());
        const b = byId.get(c.personB.toString());
        if (!a || !b) continue;
        if (![a, b].every((p) => policy.isVisible(p) && policy.detailLevel(p) === 'full' && !policy.reduceDates(p))) continue;
        // Once both have died the day is remembered through their own remembrance days instead.
        if (a.vitalStatus === 'deceased' && b.vitalStatus === 'deceased') continue;
        const start = c.startDate!;
        const pair = [a, b].sort((x, y) => (x.gender === 'male' ? -1 : y.gender === 'male' ? 1 : 0));
        for (const { date, year } of yearlyDates(start.month!, start.day!, from, to)) {
          const years = start.year && (start.qualifier ?? 'exact') === 'exact' ? year - start.year : null;
          if (years !== null && years <= 0) continue;
          const people = pair.map((p) => cards.get(p.id as string) ?? toPersonCard(p, policy));
          items.push({ date, kind: 'anniversary', title: itemTitle('anniversary', pair.map((p) => displayName(p)), years), people, years });
        }
      }
    }

    // Family events with an exact date in the range.
    if (want('event')) {
      const toKey = (day: string) => Number(day.replaceAll('-', ''));
      const filter = { ...(await archiveVisibility(access, 'createdBy', false)), 'date.sortKey': { $gte: toKey(from), $lte: toKey(to) }, 'date.day': { $gte: 1 } };
      const events = await FamilyEventModel.find(filter).sort({ 'date.sortKey': 1 }).limit(500);
      const memberIds = events.flatMap((e) => e.memberIds);
      const tagged = memberIds.length ? await FamilyMemberModel.find({ _id: { $in: memberIds }, familyId: access.familyId, deletedAt: null }) : [];
      for (const p of tagged) if (policy.isVisible(p) && !cards.has(p.id as string)) cards.set(p.id as string, toPersonCard(p, policy));
      for (const e of events) {
        const d = e.date!;
        if (d.qualifier && d.qualifier !== 'exact') continue;
        items.push({
          date: `${d.year}-${pad(d.month!)}-${pad(d.day!)}`,
          kind: 'event',
          title: itemTitle('event', [], null, e.title),
          people: e.memberIds.map((id) => cards.get(id.toString())).filter((p): p is PersonCard => !!p),
          years: null,
          eventId: e.id as string,
          ...(e.place ? { place: e.place } : {}),
        });
      }
    }

    const order: Record<CalendarKind, number> = { event: 0, birthday: 1, anniversary: 2, remembrance: 3, birth_remembrance: 4 };
    return items.sort((x, y) => x.date.localeCompare(y.date) || order[x.kind] - order[y.kind] || x.title.localeCompare(y.title));
  }
}
