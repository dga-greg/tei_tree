import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, signUp, totp } from './support';

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL('**/auth/login');
}

async function passwordStep(page: Page, email: string) {
  await page.getByLabel('E-mail address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Two-step sign-in' })).toBeVisible();
}

test('turn on two-step sign-in, sign in with a code and with a recovery code, then turn it off', async ({ page }) => {
  const email = await signUp(page, 'Ama Mensah');
  // Google sign-in is not set up in this environment, so it is not offered.
  await page.goto('/settings');
  await expect(page.getByRole('link', { name: 'Link a Google account' })).toHaveCount(0);

  const security = page.getByRole('region', { name: 'Two-step sign-in' });
  await security.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
  await security.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await security.getByRole('button', { name: 'Continue' }).click();
  await expect(security.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  await security.getByText("Can't scan it? Type this key instead").click();
  const secret = (await security.getByLabel('Key').textContent())!.replace(/\s/g, '');
  await security.getByLabel('Type the 6-digit code it shows').fill('000000');
  await security.getByRole('button', { name: 'Turn on' }).click();
  await expect(security.getByText(/That code is not right/)).toBeVisible();
  await security.getByLabel('Type the 6-digit code it shows').fill(totp(secret));
  await security.getByRole('button', { name: 'Turn on' }).click();
  const codes = await security.getByRole('list', { name: 'Recovery codes' }).locator('li').allTextContents();
  expect(codes).toHaveLength(10);
  await security.getByRole('button', { name: 'I have saved them' }).click();
  await expect(security.getByText('10 recovery codes left', { exact: false })).toBeVisible();

  // Signing in now asks for the code.
  await signOut(page);
  await passwordStep(page, email);
  await page.getByLabel('Code').fill(totp(secret, 1));
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL('**/dashboard');

  // A recovery code works once.
  await signOut(page);
  await passwordStep(page, email);
  await page.getByRole('button', { name: 'Lost your phone? Use a recovery code' }).click();
  await page.getByLabel('Recovery code').fill(codes[0]!);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL('**/dashboard');
  await signOut(page);
  await passwordStep(page, email);
  await page.getByRole('button', { name: 'Lost your phone? Use a recovery code' }).click();
  await page.getByLabel('Recovery code').fill(codes[0]!);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/That code is not right/)).toBeVisible();
  await page.getByLabel('Recovery code').fill(codes[1]!);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL('**/dashboard');

  // Turning it off needs the password and a code.
  await page.goto('/settings');
  await expect(security.getByText('8 recovery codes left', { exact: false })).toBeVisible();
  await security.getByRole('button', { name: 'Turn off' }).click();
  await security.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await security.getByLabel(/Code from your authenticator app/).fill(codes[2]!);
  await security.getByRole('button', { name: 'Turn off' }).click();
  await expect(security.getByText('Two-step sign-in is off.', { exact: false })).toBeVisible();
  await signOut(page);
  await page.getByLabel('E-mail address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard');
});

test('problems coming back from Google are explained on the sign-in page', async ({ page }) => {
  await page.goto('/auth/login?google=link_needed');
  await expect(page.getByText('An account with that Google address already exists.', { exact: false })).toBeVisible();
  await page.goto('/auth/two-step');
  await expect(page.getByRole('heading', { name: 'This sign-in link has expired' })).toBeVisible();
});
