import { expect, test } from '@playwright/test';
import { seedFamily, signUp } from './support';

test('make a family book and download it', async ({ page }) => {
  await signUp(page, 'Ama Mensah');
  await seedFamily(page);
  await page.goto('/book');
  await expect(page.getByRole('heading', { level: 1, name: 'Family book' })).toBeVisible();
  await page.getByLabel('Everything I can see').check();
  const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/books$/.test(r.url()));
  await page.getByRole('button', { name: 'Make the book' }).click();
  // The printed words keep their placeholders, for the server to fill in.
  const labels = (await sent).postDataJSON().labels;
  expect(labels).toMatchObject({ descendantsOf: 'The descendants of {name}', page: 'Page {number}', bornEvent: '{name} was born', generation: 'Generation {number}' });
  const download = page.getByRole('link', { name: 'Download PDF' });
  await expect(download).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/\d+ pages · 6 people/)).toBeVisible();
  const res = await page.request.get((await download.getAttribute('href'))!);
  expect(res.headers()['content-type']).toBe('application/pdf');
  expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
});

test('switch the interface to French and back; the choice follows the account', async ({ page }) => {
  await signUp(page, 'Kofi Mensah');
  await page.goto('/settings');
  await page.getByLabel('Language').selectOption('fr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page.getByRole('link', { name: 'Tableau de bord' })).toBeVisible();
  // Saved to the account: a fresh device signs in in French.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await page.getByLabel('Langue').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
});
