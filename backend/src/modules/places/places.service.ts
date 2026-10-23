import { Types } from 'mongoose';
import { z } from 'zod';
import type { EventKind, PersonCard, PlaceDetail, PlaceFlow, PlacesOverview, PlaceView } from '@fh/contracts';
import { AppError } from '../../core/errors.js';
import { toFuzzyDate } from '../members/member.mapper.js';
import { archiveVisibility } from '../archive/archive.shared.js';
import type { AuditService } from '../audit/audit.service.js';
import { FamilyEventModel } from '../events/event.model.js';
import type { FamilyAccess } from '../families/family-access.js';
import { FamilyMemberModel, type FamilyMemberDoc } from '../members/member.model.js';
import { toPersonCard } from '../members/member.mapper.js';
import { MemberPolicy } from '../members/member.policy.js';
import { RelationshipModel } from '../relationships/relationship.model.js';
import type { Actor } from '../relationships/relationships.service.js';
import { FamilyPlaceModel, type FamilyPlaceDoc } from './place.model.js';
import { PlaceMatcher, placeKey, suggestedName } from './places.match.js';

const live = { deletedAt: null };
const text = (max: number) => z.string().trim().max(max);
const placeFields = {
  name: text(120).min(1, 'Name the place'),
  region: text(120),
  country: text(120),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  aliases: z.array(text(120).min(1)).max(20),
  notes: text(5000),
};
const bothOrNeither = (p: { latitude?: number | null; longitude?: number | null }) => (p.latitude == null) === (p.longitude == null);
export const createPlaceBody = z.object(placeFields).partial().required({ name: true }).strict().refine(bothOrNeither, { message: 'Give both latitude and longitude, or neither', path: ['longitude'] });
export const updatePlaceBody = z.object(placeFields).partial().extend({ version: z.number().int().min(0) }).strict();

/** People's place fields as the viewer may see them (children's birthplaces are withheld like on their profiles). */
interface PersonPlaces {
  doc: FamilyMemberDoc;
  born: string | null;
  died: string | null;
  home: string | null;
}

/**
 * Places as records, and where the family has lived. Free-text places on people and events are matched to
 * places by name and other names; counts, lists and migrations are built per viewer, from what they may see.
 */
export class PlacesService {
  constructor(private readonly audit: AuditService) {}

  private assertMember(access: FamilyAccess): void {
    if (!access.membership) throw AppError.forbidden('Places are for members of the family');
  }

  private canEdit(access: FamilyAccess): boolean {
    return access.can('event.manage');
  }

  private async load(access: FamilyAccess, id: Types.ObjectId): Promise<FamilyPlaceDoc> {
    const p = await FamilyPlaceModel.findOne({ _id: id, familyId: access.familyId, ...live });
    if (!p) throw AppError.notFound('Place');
    return p;
  }

  private async peoplePlaces(access: FamilyAccess, policy: MemberPolicy): Promise<PersonPlaces[]> {
    const docs = await FamilyMemberModel.find({ familyId: access.familyId, ...live, $or: [{ birthPlace: { $ne: '' } }, { deathPlace: { $ne: '' } }, { hometown: { $ne: '' } }] });
    return docs
      .filter((d) => policy.isVisible(d))
      .map((d) => {
        const full = policy.detailLevel(d) === 'full';
        const childHidden = policy.reduceDates(d) && policy.isMinor(d);
        return { doc: d, born: full && !childHidden ? d.birthPlace || null : null, died: full ? d.deathPlace || null : null, home: full ? d.hometown || null : null };
      });
  }

  private async events(access: FamilyAccess) {
    return FamilyEventModel.find({ ...(await archiveVisibility(access, 'createdBy', false)), place: { $ne: '' } }, { title: 1, kind: 1, date: 1, place: 1 }).lean();
  }

  private toView(access: FamilyAccess, p: FamilyPlaceDoc, counts?: PlaceView['counts']): PlaceView {
    return {
      id: p.id as string,
      name: p.name,
      region: p.region,
      country: p.country,
      latitude: p.latitude ?? null,
      longitude: p.longitude ?? null,
      aliases: [...p.aliases],
      notes: p.notes,
      counts: counts ?? { births: 0, deaths: 0, hometowns: 0, events: 0 },
      viewerCan: { edit: this.canEdit(access) },
      version: p.get('version') as number,
    };
  }

  async overview(access: FamilyAccess): Promise<PlacesOverview> {
    this.assertMember(access);
    const policy = new MemberPolicy(access);
    const [places, people, events] = await Promise.all([FamilyPlaceModel.find({ familyId: access.familyId, ...live }).sort({ name: 1 }), this.peoplePlaces(access, policy), this.events(access)]);
    const matcher = new PlaceMatcher(places.map((p) => ({ id: p.id as string, keys: p.keys })));
    const counts = new Map(places.map((p) => [p.id as string, { births: 0, deaths: 0, hometowns: 0, events: 0 }]));
    const unmatched = new Map<string, { name: string; uses: number }>();
    const note = (value: string | null, field: 'births' | 'deaths' | 'hometowns' | 'events') => {
      if (!value) return null;
      const id = matcher.match(value);
      if (id) counts.get(id)![field]++;
      else {
        const name = suggestedName(value);
        const key = placeKey(name);
        if (key) unmatched.set(key, { name: unmatched.get(key)?.name ?? name, uses: (unmatched.get(key)?.uses ?? 0) + 1 });
      }
      return id;
    };
    const bornAt = new Map<string, string>();
    const flows = new Map<string, PlaceFlow>();
    const addFlow = (kind: PlaceFlow['kind'], from: string, to: string) => {
      if (from === to) return;
      const key = `${kind}|${from}|${to}`;
      const f = flows.get(key) ?? { kind, from: { id: from, name: '' }, to: { id: to, name: '' }, people: 0 };
      f.people++;
      flows.set(key, f);
    };
    for (const p of people) {
      const born = note(p.born, 'births');
      const died = note(p.died, 'deaths');
      const home = note(p.home, 'hometowns');
      if (born) {
        bornAt.set(p.doc.id as string, born);
        const later = died ?? home;
        if (later) addFlow('lifetime', born, later);
      }
    }
    for (const e of events) note(e.place, 'events');
    // A child born somewhere other than their parent: the family moved between generations.
    const links = await RelationshipModel.find({ familyId: access.familyId, ...live, type: 'parent_child', subtype: { $in: ['biological', 'adoptive'] } }, { personA: 1, personB: 1 }).lean();
    const seen = new Set<string>();
    for (const l of links) {
      const from = bornAt.get(l.personA.toString());
      const to = bornAt.get(l.personB.toString());
      // Count each child once per pair of places, however many of their parents were born there.
      const key = `${l.personB}|${from}`;
      if (from && to && !seen.has(key)) {
        seen.add(key);
        addFlow('generation', from, to);
      }
    }
    const name = new Map(places.map((p) => [p.id as string, p.name]));
    return {
      places: places.map((p) => this.toView(access, p, counts.get(p.id as string))),
      flows: [...flows.values()].map((f) => ({ ...f, from: { id: f.from.id, name: name.get(f.from.id)! }, to: { id: f.to.id, name: name.get(f.to.id)! } })).sort((a, b) => b.people - a.people),
      suggestions: [...unmatched.values()].sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name)).slice(0, 30),
    };
  }

  async detail(access: FamilyAccess, id: Types.ObjectId): Promise<PlaceDetail> {
    this.assertMember(access);
    const place = await this.load(access, id);
    const policy = new MemberPolicy(access);
    const matcher = new PlaceMatcher([{ id: place.id as string, keys: place.keys }]);
    const here = (v: string | null) => !!v && matcher.match(v) !== null;
    const people = await this.peoplePlaces(access, policy);
    const cards = (filter: (p: PersonPlaces) => boolean): PersonCard[] =>
      people.filter(filter).map((p) => toPersonCard(p.doc, policy)).sort((a, b) => (a.birthDate?.sortKey ?? Infinity) - (b.birthDate?.sortKey ?? Infinity) || a.displayName.localeCompare(b.displayName));
    const born = cards((p) => here(p.born));
    const died = cards((p) => here(p.died));
    const hometown = cards((p) => here(p.home));
    const events = (await this.events(access)).filter((e) => here(e.place)).map((e) => ({ id: e._id.toString(), title: e.title, kind: e.kind as EventKind, date: toFuzzyDate(e.date) }));
    return { place: this.toView(access, place, { births: born.length, deaths: died.length, hometowns: hometown.length, events: events.length }), born, died, hometown, events };
  }

  private keysOf(name: string, aliases: string[]): string[] {
    return [...new Set([name, ...aliases].map(placeKey).filter(Boolean))];
  }

  private async assertUnique(access: FamilyAccess, keys: string[], except?: Types.ObjectId): Promise<void> {
    const clash = await FamilyPlaceModel.findOne({ familyId: access.familyId, ...live, keys: { $in: keys }, ...(except ? { _id: { $ne: except } } : {}) }, { name: 1 });
    if (clash) throw new AppError('CONFLICT', `“${clash.name}” already has that name. Add it as another name of that place instead.`);
  }

  async create(access: FamilyAccess, actor: Actor, input: z.output<typeof createPlaceBody>): Promise<PlaceView> {
    this.assertMember(access);
    access.assert('event.manage');
    const aliases = input.aliases ?? [];
    const keys = this.keysOf(input.name, aliases);
    await this.assertUnique(access, keys);
    const place = await FamilyPlaceModel.create({ familyId: access.familyId, ...input, aliases, keys, createdBy: actor.userId });
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'place.create', targetType: 'place', targetId: place._id, after: place.toObject(), requestId: actor.requestId, ip: actor.ip });
    return this.toView(access, place);
  }

  async update(access: FamilyAccess, actor: Actor, id: Types.ObjectId, patch: z.output<typeof updatePlaceBody>): Promise<PlaceView> {
    this.assertMember(access);
    access.assert('event.manage');
    const place = await this.load(access, id);
    if ((place.get('version') as number) !== patch.version) throw new AppError('VERSION_CONFLICT', 'This place was changed by someone else. Reload and try again.');
    const before = place.toObject();
    const { version: _v, ...fields } = patch;
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) place.set(k, v);
    if (!bothOrNeither(place)) throw new AppError('VALIDATION_FAILED', 'Give both latitude and longitude, or neither', [{ path: 'longitude', message: 'Both or neither' }]);
    place.keys = this.keysOf(place.name, place.aliases);
    await this.assertUnique(access, place.keys, place._id);
    await place.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'place.update', targetType: 'place', targetId: place._id, before, after: place.toObject(), requestId: actor.requestId, ip: actor.ip });
    return this.toView(access, place);
  }

  async remove(access: FamilyAccess, actor: Actor, id: Types.ObjectId): Promise<void> {
    this.assertMember(access);
    access.assert('event.manage');
    const place = await this.load(access, id);
    place.deletedAt = new Date();
    place.deletedBy = actor.userId;
    await place.save();
    await this.audit.record({ familyId: access.familyId, actorId: actor.userId, actorRole: access.role, action: 'place.delete', targetType: 'place', targetId: place._id, before: { name: place.name }, requestId: actor.requestId, ip: actor.ip });
  }
}
