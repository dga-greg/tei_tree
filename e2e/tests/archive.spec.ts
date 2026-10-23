import { expect, test } from '@playwright/test';
import { api, files, seedFamily, signUp } from './support';

test('upload photos, describe them and use one as a profile photo', async ({ page }) => {
  await signUp(page, 'Ama Admin');
  const fam = await seedFamily(page);
  await page.goto('/media');
  await expect(page.getByText('The archive is empty so far.')).toBeVisible();
  await page.getByRole('button', { name: 'Add files' }).click();
  const dialog = page.locator('fh-upload-dialog');
  await dialog.locator('input[type=file]').setInputFiles([files.png('kofi-portrait.png', 1), files.png('farm.png', 2)]);
  await dialog.locator('input[role=combobox]').fill('kofi');
  await page.getByRole('option', { name: /Kofi Mensah/ }).click();
  await dialog.getByLabel('Where it comes from').fill("Auntie Ama's album");
  await dialog.getByRole('button', { name: 'Upload 2 files' }).click();
  await expect(page.getByText('2 file(s) added to the archive.')).toBeVisible();
  await expect(page.locator('fh-media-grid li')).toHaveCount(2);

  await page.getByRole('button', { name: /Photo: kofi portrait/ }).click();
  const viewer = page.locator('fh-media-viewer');
  await expect(viewer.getByText("Auntie Ama's album")).toBeVisible();
  await viewer.getByRole('button', { name: 'Use as profile photo of Kofi Mensah' }).click();
  await expect(viewer.getByText("This is now Kofi Mensah's profile photo.")).toBeVisible();
  await viewer.getByRole('button', { name: 'Close' }).click();

  await page.goto(`/members/${fam.people['kofi']}`);
  await expect(page.locator('header fh-person-avatar img')).toBeVisible();
  await expect(page.locator('#media-h')).toBeVisible();
  await expect(page.locator('section:has(#media-h) fh-media-grid li')).toHaveCount(2);

  // The same file twice is refused.
  await page.goto('/media');
  await page.getByRole('button', { name: 'Add files' }).click();
  await page.locator('fh-upload-dialog input[type=file]').setInputFiles([files.png('copy.png', 1)]);
  await page.locator('fh-upload-dialog').getByRole('button', { name: 'Upload' }).click();
  await expect(page.locator('fh-upload-dialog').getByText(/already in the family archive/)).toBeVisible();
});

test('record an event and an oral history, and read them on the timeline', async ({ page }) => {
  await signUp(page, 'Ama Admin');
  await seedFamily(page);
  await page.goto('/history');
  await page.getByRole('button', { name: 'Add an event' }).click();
  const ev = page.locator('fh-event-dialog');
  await ev.getByLabel('Kind').selectOption('migration');
  await ev.getByLabel('Title').fill('Kofi moves to Kumasi');
  await ev.locator('fh-fuzzy-date-field input[placeholder=Year]').fill('1905');
  await ev.getByLabel('Where').fill('Kumasi');
  await ev.getByRole('button', { name: 'Add to the timeline' }).click();
  await expect(ev.getByRole('heading', { name: 'Kofi moves to Kumasi' })).toBeVisible();
  await ev.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('heading', { name: '1900s' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Migration · 1905 Kofi moves to Kumasi/ })).toBeVisible();
  await expect(page.getByText('Kofi Mensah was born')).toBeVisible();

  await page.getByRole('link', { name: 'Write a story' }).click();
  await page.getByLabel('Kind').selectOption('oral_history');
  await page.getByLabel('Title').fill('How Kofi came to Kumasi');
  await page.getByLabel('Told by').fill('Nana Akua');
  await page.locator('fh-fuzzy-date-field input[placeholder=Year]').fill('1998');
  await page.locator('#st-body').fill('He walked from the coast.\n\nHe planted cocoa.');
  await page.getByRole('button', { name: 'Attach files' }).click();
  await page.locator('fh-upload-dialog input[type=file]').setInputFiles([files.wav()]);
  await page.locator('fh-upload-dialog').getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByLabel('The recording')).toBeChecked();
  await page.getByRole('button', { name: 'Publish the story' }).click();
  await page.waitForURL(/\/history\/stories\/[a-f0-9]{24}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'How Kofi came to Kumasi' })).toBeVisible();
  const duration = await page.locator('audio').evaluate((a: HTMLAudioElement) =>
    a.readyState >= 1 ? a.duration : new Promise<number>((r) => a.addEventListener('loadedmetadata', () => r(a.duration))),
  );
  expect(duration).toBeGreaterThan(0.9);

  await page.goto('/history?tab=stories');
  await expect(page.getByRole('link', { name: /How Kofi came to Kumasi/ })).toBeVisible();
});

test('uploads by members wait for review', async ({ page, browser }) => {
  await signUp(page, 'Ama Admin');
  const fam = await seedFamily(page);
  const context = await browser.newContext();
  const member = await context.newPage();
  const email = await signUp(member, 'Esi Mensah');
  await api(page)('POST', `/families/${fam.id}/invitations`, { email, role: 'family_member' });
  const { mailLink } = await import('./support');
  const token = new URL(await mailLink(email, '/invitations/accept'), 'http://x').searchParams.get('token');
  await api(member)('POST', '/invitations/accept', { token });

  await member.goto('/media');
  await member.getByRole('button', { name: 'Add files' }).click();
  await member.locator('fh-upload-dialog input[type=file]').setInputFiles([files.png('wedding.png', 7)]);
  await member.locator('fh-upload-dialog').getByRole('button', { name: 'Upload' }).click();
  await expect(member.getByText('A moderator will review them')).toBeVisible();
  await expect(member.getByText('In review')).toBeVisible();

  await page.goto('/contributions');
  await page.getByRole('button', { name: /Add “wedding” to the archive/ }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approved and applied.')).toBeVisible();
  await member.reload();
  await expect(member.locator('fh-media-grid li')).toHaveCount(1);
  await expect(member.getByText('In review')).toHaveCount(0);
  await context.close();
});
