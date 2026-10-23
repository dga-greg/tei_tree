import { expect, test, type Browser } from '@playwright/test';
import { api, mailLink, PASSWORD, seedFamily, signUp, uniqueEmail } from './support';

async function invitedMember(browser: Browser, admin: import('@playwright/test').Page, familyId: string) {
  const email = uniqueEmail('kojo');
  await admin.goto('/invitations');
  await admin.getByLabel(/E-mail/).first().fill(email);
  await admin.getByRole('button', { name: 'Send invitation' }).click();
  await expect(admin.getByText(email, { exact: true })).toBeVisible();

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(await mailLink(email, '/invitations/accept'));
  await expect(page.getByRole('heading', { name: /Join the/ })).toBeVisible();
  await page.getByRole('link', { name: 'Create an account' }).click();
  await page.getByLabel('Your name').fill('Kojo Mensah');
  await page.getByLabel('E-mail address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  // Back on the invitation, they join at once: the link already confirmed their address.
  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('heading', { level: 1, name: 'Mensah Family' })).toBeVisible();
  void familyId;
  return { page, context, email };
}

test('someone already signed up sees the invitation on their dashboard and joins', async ({ page, browser }) => {
  await signUp(page, 'Ama Admin');
  const fam = await seedFamily(page);

  const context = await browser.newContext();
  const relative = await context.newPage();
  const email = await signUp(relative, 'Esi Mensah');
  await relative.goto('/dashboard');
  await expect(relative.getByText('You are not part of a family tree yet')).toBeVisible();

  await api(page)('POST', `/families/${fam.id}/invitations`, { email, role: 'family_member', message: 'Welcome, Esi!' });
  await relative.goto('/dashboard');
  await expect(relative.getByText(/invited you to join the Mensah Family/)).toBeVisible();
  await expect(relative.getByText('“Welcome, Esi!”')).toBeVisible();
  await relative.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(relative.getByRole('heading', { level: 1, name: 'Mensah Family' })).toBeVisible();
  await expect(relative.getByText(/invited you to join/)).toHaveCount(0);
  await context.close();
});

test('invite a relative, who suggests a correction that an administrator approves', async ({ page, browser }) => {
  await signUp(page, 'Ama Admin');
  const fam = await seedFamily(page);
  const member = await invitedMember(browser, page, fam.id);

  await member.page.goto(`/members/${fam.people['kwame']}`);
  await member.page.getByRole('link', { name: 'Suggest a correction' }).click();
  await member.page.getByLabel('Hometown').fill('Kumasi');
  await member.page.locator('#proposal-note').fill('From his birth certificate');
  await member.page.getByRole('button', { name: 'Send suggestion' }).click();
  await member.page.waitForURL('**/contributions**');
  await expect(member.page.getByText('Correct details of Kwame Mensah').first()).toBeVisible();

  await page.goto('/contributions');
  await page.getByRole('button', { name: /Correct details of Kwame Mensah/ }).click();
  await expect(page.getByRole('cell', { name: 'Kumasi' })).toBeVisible();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approved and applied.')).toBeVisible();
  const kwame = await api(page)<{ hometown: string }>('GET', `/families/${fam.id}/members/${fam.people['kwame']}`);
  expect(kwame.hometown).toBe('Kumasi');

  // Link corrections and link removals go through the same review.
  const call = api(member.page);
  const profile = await api(page)<{ relatives: { parents: { person: { id: string }; relationshipId: string }[] } }>('GET', `/families/${fam.id}/members/${fam.people['yaw']}`);
  const edge = profile.relatives.parents[0]!.relationshipId;
  await call('POST', `/families/${fam.id}/contributions`, { kind: 'relationship.update', targetId: edge, payload: { verification: 'unverified' }, note: 'Not sure about this' });
  await page.goto('/contributions');
  await page.getByRole('button', { name: /Correct the link between/ }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approved and applied.')).toBeVisible();
  expect((await api(page)<{ verification: string }>('GET', `/families/${fam.id}/relationships/${edge}`)).verification).toBe('unverified');

  await member.page.goto(`/members/${fam.people['yaw']}`);
  await member.page.getByRole('button', { name: 'Propose removing the link to Kwame Mensah' }).click();
  await member.page.locator('#prompt-text').fill('Yaw is Kwame’s nephew, not his son');
  await member.page.getByRole('button', { name: 'Send suggestion' }).click();
  await expect(member.page.getByText('sent to the moderators')).toBeVisible();
  await page.goto('/contributions');
  await page.getByRole('button', { name: /Remove the link between/ }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approved and applied.')).toBeVisible();
  const after = await api(page)<{ relatives: { parents: unknown[] } }>('GET', `/families/${fam.id}/members/${fam.people['yaw']}`);
  expect(after.relatives.parents).toHaveLength(0);

  // The change history records it, and it can be undone.
  await page.goto('/family/history');
  await expect(page.getByText('Removed a link').first()).toBeVisible();
  await page.locator('li', { hasText: 'Removed a link' }).first().getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText('Restored.')).toBeVisible();
  expect((await api(page)<{ relatives: { parents: unknown[] } }>('GET', `/families/${fam.id}/members/${fam.people['yaw']}`)).relatives.parents).toHaveLength(1);
  await member.context.close();
});

test('a relative claims their profile and then keeps their own details up to date', async ({ page, browser }) => {
  await signUp(page, 'Ama Admin');
  const fam = await seedFamily(page);
  const member = await invitedMember(browser, page, fam.id);

  await member.page.goto(`/members/${fam.people['yaw']}`);
  await member.page.getByRole('button', { name: 'This is me' }).click();
  await member.page.locator('#prompt-text').fill('I am Yaw, son of Kwame');
  await member.page.getByRole('button', { name: 'Send claim' }).click();
  await expect(member.page.getByText('Your claim has been sent')).toBeVisible();

  await page.goto('/contributions');
  await page.getByRole('button', { name: /says they are Yaw Mensah/ }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approved and applied.')).toBeVisible();

  await member.page.goto(`/members/${fam.people['yaw']}`);
  await member.page.getByRole('link', { name: 'Edit my profile' }).click();
  await member.page.getByLabel('Biography').fill('Teacher in Accra.');
  await member.page.getByRole('button', { name: 'Save', exact: true }).click();
  await member.page.waitForURL(`**/members/${fam.people['yaw']}`);
  await expect(member.page.getByText('Teacher in Accra.')).toBeVisible();

  await page.goto('/family/members');
  await expect(page.locator('p', { hasText: 'Linked to' }).getByRole('link', { name: 'Yaw Mensah' })).toBeVisible();
  await member.context.close();
});
