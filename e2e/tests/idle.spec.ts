import { expect, test } from '@playwright/test';
import { PASSWORD, signUp } from './support';

test('signs out after 30 minutes without activity, with a warning a minute before', async ({ page }) => {
  await page.clock.install();
  await signUp(page, 'Esi Idle');
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // A minute before: the warning, which keeps the person signed in when they answer it.
  await page.clock.fastForward('29:05');
  const warning = page.getByRole('alertdialog');
  await expect(warning.getByRole('heading', { name: 'Are you still there?' })).toBeVisible();
  await expect(warning.getByText(/signed out in \d+ seconds/)).toBeVisible();
  await warning.getByRole('button', { name: 'Stay signed in' }).click();
  await expect(warning).toHaveCount(0);

  // No answer: signed out, and back to the same page after signing in again.
  await page.clock.fastForward('30:30');
  await expect(page).toHaveURL(/\/auth\/login\?reason=idle/);
  await expect(page.getByText('You were signed out because the app was not used for a while.', { exact: false })).toBeVisible();
  await expect.poll(async () => (await page.request.get('/api/v1/auth/me')).status()).toBe(401);
});

test('"Keep me signed in on this device" skips the idle sign-out', async ({ page }) => {
  const email = await signUp(page, 'Kojo Kept');
  await page.request.post('/api/v1/auth/logout', { headers: { 'X-XSRF-TOKEN': (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '' } });
  await page.clock.install();
  await page.goto('/auth/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Keep me signed in on this device').check();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
  await page.clock.fastForward('45:00');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard/);
});
