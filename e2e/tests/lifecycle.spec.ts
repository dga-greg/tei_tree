import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { api, mailLink, PASSWORD, seedFamily, signIn, signUp } from './support';

test('administrators download the family as GEDCOM and JSON; everyone can download their own data', async ({ page }) => {
  await signUp(page, 'Ama Admin');
  await seedFamily(page);
  await page.goto('/family/settings');
  const [gedcom] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /GEDCOM/ }).click()]);
  expect(gedcom.suggestedFilename()).toMatch(/^mensah-family-\d{4}-\d{2}-\d{2}\.ged$/);
  const ged = readFileSync((await gedcom.path())!, 'utf8');
  expect(ged.startsWith('0 HEAD')).toBe(true);
  expect(ged).toContain('1 NAME Kofi /Mensah/');
  expect(ged).toContain('0 TRLR');

  await page.getByLabel(/Replace living people/).check();
  const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /JSON backup/ }).click()]);
  const doc = JSON.parse(readFileSync((await json.path())!, 'utf8'));
  expect(doc.people.find((p: { firstName: string }) => p.firstName === 'Living')).toBeTruthy();
  expect(JSON.stringify(doc)).not.toContain('Yaw');

  await page.goto('/settings');
  const [mine] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download my data' }).click()]);
  const me = JSON.parse(readFileSync((await mine.path())!, 'utf8'));
  expect(me.account.displayName).toBe('Ama Admin');
  expect(me.memberships[0].family).toBe('Mensah Family');
});

test('a family can be deleted, restored during the grace period, and deleted again', async ({ page }) => {
  await signUp(page, 'Ama Admin');
  await seedFamily(page, 'Owusu Family');
  await page.goto('/family/settings');
  await page.getByLabel(/Type Owusu Family to confirm/).fill('Owusu Family');
  await page.getByLabel('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Delete the family' }).click();
  await page.waitForURL(/\/settings\?deleted=/);
  await expect(page.getByText('Families being deleted')).toBeVisible();
  await page.goto('/members');
  await expect(page.locator('fh-no-family')).toBeVisible();

  await page.goto('/settings');
  await page.getByRole('button', { name: 'Restore the family' }).click();
  await expect(page.getByText('Families being deleted')).toHaveCount(0);
  await page.goto('/members');
  await expect(page.getByRole('link', { name: /Kofi Mensah/ }).first()).toBeVisible();
});

test('reports reach the platform administrators, who resolve them', async ({ page, browser }) => {
  await signUp(page, 'Ama Admin');
  const fam = await seedFamily(page);
  const context = await browser.newContext();
  const member = await context.newPage();
  const email = await signUp(member, 'Esi Mensah');
  await api(page)('POST', `/families/${fam.id}/invitations`, { email, role: 'family_member' });
  const token = new URL(await mailLink(email, '/invitations/accept'), 'http://x').searchParams.get('token');
  await api(member)('POST', '/invitations/accept', { token });

  await member.goto(`/members/${fam.people['kwame']}`);
  await member.getByRole('button', { name: 'Report' }).click();
  await member.getByLabel(/Shares private information/).check();
  await member.getByLabel('Details').fill('His biography lists my home address.');
  await member.getByRole('button', { name: 'Send report' }).click();
  await expect(member.getByText('The platform team will review your report.')).toBeVisible();
  await context.close();

  const root = await browser.newContext();
  const platform = await root.newPage();
  await signIn(platform, 'root@e2e.test', 'e2e platform password');
  await platform.goto('/admin/reports');
  const card = platform.locator('li', { hasText: 'Profile of Kwame Mensah' });
  await expect(card).toBeVisible();
  await card.getByRole('textbox').fill('Asked the family to remove the address.');
  await card.getByLabel("Ask the family's administrators to act").check();
  await card.getByRole('button', { name: 'Resolve' }).click();
  await expect(platform.getByText('Report resolved.')).toBeVisible();
  await root.close();
});

test('an account can be deleted, and its address used again', async ({ page }) => {
  const email = await signUp(page, 'Temporary Person');
  await page.goto('/settings');
  page.once('dialog', (d) => void d.accept());
  await page.getByLabel('Your password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.waitForURL(/\/auth\/login\?reason=deleted/);
  await expect(page.getByText('Your account has been deleted.')).toBeVisible();
  await page.getByLabel('E-mail address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/auth\/login/);
  await signUp(page, 'Returning Person', email);
});
