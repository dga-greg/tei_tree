import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/core/logger.js';
import { EmailDispatcher } from '../src/infra/email-dispatcher.js';
import type { Mailer, MailMessage } from '../src/infra/mailer.js';
import { addPerson, buildApp, connectTestDb, disconnectTestDb, registeredClient, type TestContext } from './helpers.js';

const message: MailMessage = { to: 'a@example.org', subject: 'Hello', text: 'Hi', html: '<p>Hi</p>' };

describe('e-mail is sent straight from the API', () => {
  it('retries a failed send, then gives up quietly', async () => {
    let calls = 0;
    const flaky: Mailer = {
      send: async () => {
        calls++;
        if (calls < 3) throw new Error('SMTP down');
      },
    };
    const dispatcher = new EmailDispatcher(flaky, createLogger('silent', false), [5, 5]);
    dispatcher.dispatch(message);
    await dispatcher.close();
    expect(calls).toBe(3);

    let failing = 0;
    const down: Mailer = {
      send: async () => {
        failing++;
        throw new Error('SMTP down');
      },
    };
    const giveUp = new EmailDispatcher(down, createLogger('silent', false), [5]);
    expect(() => giveUp.dispatch(message)).not.toThrow();
    await giveUp.close();
    expect(failing).toBe(2);
  });
});

describe('large families are recalculated in the background, in the same process', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    await connectTestDb();
    ctx = buildApp({ GENERATION_INLINE_LIMIT: '1' });
  });
  afterAll(async () => {
    await ctx.instance.close();
    await disconnectTestDb();
  });

  it('numbers new people shortly after the answer, without a worker', async () => {
    const admin = await registeredClient(ctx, 'big@example.org');
    const fam = (await admin.post('/families', { name: 'Big Family', founder: { firstName: 'Kofi', surname: 'Mensah', vitalStatus: 'deceased' } })).body.data;
    const kwame = await addPerson(admin, fam.id, { firstName: 'Kwame', surname: 'Mensah' }, { parents: [{ memberId: fam.foundingMemberId, subtype: 'biological', verification: 'verified' }] });
    // Family IDs are given within the request either way.
    const now = (await admin.get(`/families/${fam.id}/members/${kwame}`)).body.data;
    expect(now.familyCode).toBe('G1.1');
    await ctx.instance.close();
    const later = (await admin.get(`/families/${fam.id}/members/${kwame}`)).body.data;
    expect(later.generation).toMatchObject({ number: 2, status: 'computed' });
  });
});
