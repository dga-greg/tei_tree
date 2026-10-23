import { expect, test } from '@playwright/test';
import { mailLink, PASSWORD, signIn, uniqueEmail } from './support';

test('sign up, confirm the e-mail address, sign out and back in', async ({ page }) => {
  const email = uniqueEmail('ama');
  await page.goto('/auth/register');
  await page.getByLabel('Your name').fill('Ama Mensah');
  await page.getByLabel('E-mail address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/auth\/register/);

  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('status').filter({ hasText: 'Please confirm' })).toBeVisible();

  await page.goto(await mailLink(email, '/auth/verify-email'));
  await expect(page.getByText(/confirmed|verified/i).first()).toBeVisible();
  await page.goto('/dashboard');
  await expect(page.getByRole('status').filter({ hasText: 'Please confirm' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL('**/auth/login');

  await page.getByLabel('E-mail address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('not the password');
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/incorrect|not correct|invalid/i).first()).toBeVisible();

  await signIn(page, email);
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard/);
});

test('pages behind sign-in send visitors to the sign-in page and back', async ({ page }) => {
  await page.goto('/members');
  await page.waitForURL(/\/auth\/login/);
  const email = await (async () => {
    const e = uniqueEmail('kojo');
    await page.goto('/auth/register');
    await page.getByLabel('Your name').fill('Kojo');
    await page.getByLabel('E-mail address').fill(e);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL('**/dashboard');
    return e;
  })();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.goto('/settings');
  await page.waitForURL(/\/auth\/login\?returnUrl=%2Fsettings/);
  await page.getByLabel('E-mail address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/settings');
});
