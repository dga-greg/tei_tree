/**
 * Performance check: seeds one large family directly in MongoDB, then times the main endpoints through
 * the real application (in-process, no network) and compares the 95th percentile with a budget.
 *
 *   npm run perf -w backend                     # 20 000 people, temporary MongoDB replica set
 *   PERF_PEOPLE=50000 npm run perf -w backend
 *   PERF_MONGODB_URI=mongodb://… npm run perf   # use an existing replica set (a new database is created)
 *
 * Exits with status 1 when a budget is exceeded. Writes perf/report.json.
 */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/core/logger.js';
import { fuzzyDateSortKey } from '@fh/contracts';
import { MemoryMailer } from '../src/infra/mailer.js';
import { syncIndexes } from '../src/infra/mongo.js';
import { FamilyEventModel } from '../src/modules/events/event.model.js';
import { FamilyMemberModel } from '../src/modules/members/member.model.js';
import { searchFields } from '../src/modules/members/members.service.js';
import { RelationshipModel } from '../src/modules/relationships/relationship.model.js';
import { FamilyStoryModel } from '../src/modules/stories/story.model.js';
import { UserModel } from '../src/modules/users/user.model.js';

const PEOPLE = Number(process.env['PERF_PEOPLE'] ?? 20_000);
const RUNS = Number(process.env['PERF_RUNS'] ?? 15);

/** p95 budgets in milliseconds, for an in-process run on a developer machine or CI runner. */
const BUDGETS: Record<string, number> = {
  'tree root (depth 3)': 300,
  'tree descendants (depth 4)': 400,
  'members list (page 1)': 250,
  'members search': 200,
  'person profile': 200,
  'relationship finder (warm)': 150,
  dashboard: 800,
  'generations summary': 500,
  'timeline (one person)': 300,
  'stories list': 200,
  'media list': 200,
};
/** Single-run budgets for heavy operations. */
const ONE_OFF_BUDGETS: Record<string, number> = {
  'relationship finder (cold, loads the graph)': 3000,
  'generation recalculation (whole family)': 15000,
  'GEDCOM export (whole family)': 15000,
};

const FIRST = ['Kwame', 'Ama', 'Yaw', 'Akosua', 'Kwesi', 'Efua', 'Kojo', 'Adwoa', 'Kwaku', 'Abena', 'Kwabena', 'Afia', 'Kofi', 'Esi', 'Yaa', 'Akua', 'Fiifi', 'Ekow', 'Araba', 'Nana'];
const SURNAMES = ['Mensah', 'Owusu', 'Asante', 'Boateng', 'Osei', 'Appiah', 'Agyeman', 'Darko'];

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function main(): Promise<void> {
  let replSet: MongoMemoryReplSet | null = null;
  let uri = process.env['PERF_MONGODB_URI'];
  if (!uri) {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    uri = replSet.getUri();
  }
  const dbUri = new URL(uri);
  dbUri.pathname = `/fh_perf_${Date.now()}`;
  await mongoose.connect(dbUri.toString());
  const logger = createLogger((process.env['PERF_LOG'] as 'error' | undefined) ?? 'silent', false);
  await syncIndexes(logger);
  const env = loadEnv({
    NODE_ENV: 'test',
    APP_ORIGIN: 'http://localhost:4200',
    MONGODB_URI: dbUri.toString(),
    JWT_ACCESS_SECRET: 'perf-access-secret-that-is-at-least-32-chars',
    CSRF_SECRET: 'perf-csrf-secret-that-is-at-least-32-characters',
    ARGON2_MEMORY_KIB: '1024',
    ARGON2_TIME_COST: '1',
    RATE_LIMIT_GLOBAL_PER_MINUTE: '1000000',
    RATE_LIMIT_AUTH_PER_15_MINUTES: '1000',
    GENERATION_INLINE_LIMIT: String(PEOPLE * 2),
  });
  const instance = createApp({ env, logger, mailer: new MemoryMailer() });
  const agent = request.agent(instance.app);
  let csrf = '';
  const track = (res: request.Response) => {
    const c = ((res.headers['set-cookie'] as unknown as string[]) ?? []).find((x) => x.startsWith('XSRF-TOKEN='));
    if (c) csrf = decodeURIComponent(c.split(';')[0]!.slice('XSRF-TOKEN='.length));
    return res;
  };
  track(await agent.get('/api/v1/auth/csrf'));
  track(await agent.post('/api/v1/auth/register').set('X-XSRF-TOKEN', csrf).send({ email: 'perf@example.org', password: 'a long perf password', displayName: 'Perf' }));
  const fam = track(await agent.post('/api/v1/families').set('X-XSRF-TOKEN', csrf).send({ name: 'Perf Family', founder: { firstName: 'Kofi', surname: 'Mensah', vitalStatus: 'deceased', birthDate: { year: 1800 } } })).body.data;
  const familyId = new Types.ObjectId(fam.id as string);
  const founder = new Types.ObjectId(fam.foundingMemberId as string);
  const userId = (await UserModel.findOne({ email: 'perf@example.org' }))!._id;

  // ---- seed: a branching tree, each person with a married-in partner, ~3 children per couple
  const t0 = performance.now();
  const people: Record<string, unknown>[] = [];
  const edges: Record<string, unknown>[] = [];
  const year = (gen: number, i: number) => 1800 + gen * 27 + (i % 9);
  // Bulk inserts below skip Mongoose defaults and timestamps, so set them here.
  const now = new Date();
  let frontier = [{ id: founder, gen: 0 }];
  let n = 0;
  const person = (gen: number, surname: string, extra: Record<string, unknown> = {}) => {
    const firstName = FIRST[n % FIRST.length]!;
    const birthDate = { year: year(gen, n), qualifier: 'exact', sortKey: fuzzyDateSortKey({ year: year(gen, n) }) };
    const doc = { _id: new Types.ObjectId(), createdAt: now, updatedAt: now, familyId, firstName, surname, vitalStatus: year(gen, n) > 1940 ? 'living' : 'deceased', birthDate, hometown: n % 2 ? 'Kumasi' : 'Accra', createdBy: userId, ...searchFields({ firstName, surname }), ...extra };
    n++;
    people.push(doc);
    return doc._id;
  };
  while (people.length < PEOPLE - 1 && frontier.length) {
    const next: typeof frontier = [];
    for (const parent of frontier) {
      if (people.length >= PEOPLE - 1) break;
      const partner = person(parent.gen, SURNAMES[n % SURNAMES.length]!);
      edges.push({ createdAt: now, updatedAt: now, familyId, type: 'partnership', personA: parent.id, personB: partner, subtype: 'marriage', status: 'current', verification: 'verified', startDate: { year: year(parent.gen, n) + 22, qualifier: 'exact', sortKey: (year(parent.gen, n) + 22) * 10000 }, createdBy: userId });
      for (let c = 0; c < 3 && people.length < PEOPLE - 1; c++) {
        const child = person(parent.gen + 1, 'Mensah');
        for (const p of [parent.id, partner]) edges.push({ createdAt: now, updatedAt: now, familyId, type: 'parent_child', personA: p, personB: child, subtype: 'biological', verification: 'verified', createdBy: userId });
        next.push({ id: child, gen: parent.gen + 1 });
      }
    }
    frontier = next;
  }
  for (let i = 0; i < people.length; i += 5000) await FamilyMemberModel.insertMany(people.slice(i, i + 5000), { lean: true });
  for (let i = 0; i < edges.length; i += 5000) await RelationshipModel.insertMany(edges.slice(i, i + 5000), { lean: true });
  const deepest = frontier[0]?.id ?? founder;
  const cousin = frontier.at(-1)?.id ?? founder;
  await FamilyEventModel.insertMany(Array.from({ length: 300 }, (_, i) => ({ familyId, kind: 'reunion', title: `Reunion ${i}`, date: { year: 1850 + i % 170, qualifier: 'exact', sortKey: (1850 + (i % 170)) * 10000 }, memberIds: [founder], createdBy: userId })));
  await FamilyStoryModel.insertMany(Array.from({ length: 500 }, (_, i) => ({ familyId, kind: 'story', title: `Story ${i}`, body: 'Once upon a time. '.repeat(50), memberIds: [founder], createdBy: userId, status: 'published', searchText: `story ${i}` })));
  const seedMs = performance.now() - t0;
  console.log(`Seeded ${people.length + 1} people and ${edges.length} relationships in ${(seedMs / 1000).toFixed(1)} s`);

  const base = `/api/v1/families/${familyId.toString()}`;
  const get = async (path: string) => {
    const res = await agent.get(path);
    if (res.status >= 400) throw new Error(`${path} → ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
    return res;
  };
  const time = async (fn: () => Promise<unknown>) => {
    const s = performance.now();
    await fn();
    return performance.now() - s;
  };

  const results: { name: string; p50?: number; p95: number; budget: number; runs: number; ok: boolean }[] = [];
  const oneOff = async (name: string, fn: () => Promise<unknown>) => {
    const ms = await time(fn);
    results.push({ name, p95: ms, budget: ONE_OFF_BUDGETS[name]!, runs: 1, ok: ms <= ONE_OFF_BUDGETS[name]! });
  };
  const repeated = async (name: string, fn: () => Promise<unknown>) => {
    await fn(); // warm-up
    const samples: number[] = [];
    for (let i = 0; i < RUNS; i++) samples.push(await time(fn));
    const p95 = percentile(samples, 95);
    results.push({ name, p50: percentile(samples, 50), p95, budget: BUDGETS[name]!, runs: RUNS, ok: p95 <= BUDGETS[name]! });
  };

  await oneOff('generation recalculation (whole family)', () => agent.post(`${base}/generations/recalculate`).set('X-XSRF-TOKEN', csrf).send({}).expect(202));
  await oneOff('relationship finder (cold, loads the graph)', () => get(`${base}/relationships/between?a=${deepest.toString()}&b=${cousin.toString()}`));
  await repeated('relationship finder (warm)', () => get(`${base}/relationships/between?a=${deepest.toString()}&b=${cousin.toString()}`));
  await repeated('tree root (depth 3)', () => get(`${base}/tree/root?depth=3`));
  await repeated('tree descendants (depth 4)', () => get(`${base}/tree/nodes/${founder.toString()}/descendants?depth=4`));
  await repeated('members list (page 1)', () => get(`${base}/members?page=1&pageSize=24`));
  await repeated('members search', () => get(`${base}/members/search?q=kwa`));
  await repeated('person profile', () => get(`${base}/members/${deepest.toString()}`));
  await repeated('dashboard', () => get(`${base}/dashboard`));
  await repeated('generations summary', () => get(`${base}/generations`));
  await repeated('timeline (one person)', () => get(`${base}/timeline?memberId=${founder.toString()}`));
  await repeated('stories list', () => get(`${base}/stories`));
  await repeated('media list', () => get(`${base}/media`));
  await oneOff('GEDCOM export (whole family)', () => get(`${base}/export?format=gedcom`));

  console.log(`\n${people.length + 1} people · ${RUNS} runs per endpoint\n`);
  console.log('Operation'.padEnd(46) + 'p50 ms'.padStart(9) + 'p95 ms'.padStart(9) + 'budget'.padStart(9) + '  ');
  for (const r of results) {
    console.log(r.name.padEnd(46) + (r.p50 != null ? r.p50.toFixed(0) : '–').padStart(9) + r.p95.toFixed(0).padStart(9) + String(r.budget).padStart(9) + (r.ok ? '  ok' : '  OVER BUDGET'));
  }
  writeFileSync(new URL('./report.json', import.meta.url), JSON.stringify({ people: people.length + 1, relationships: edges.length, runs: RUNS, seedMs, results, at: new Date().toISOString() }, null, 2));

  await instance.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await replSet?.stop();
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
