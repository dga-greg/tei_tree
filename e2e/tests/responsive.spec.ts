import { expect, test } from '@playwright/test';
import { seedFamily, signUp } from './support';

/** Runs on a phone-sized screen (see playwright.config.ts): nothing may overflow sideways. */
test('every main page fits a phone screen', async ({ page }) => {
  await signUp(page, 'Ama Admin');
  const fam = await seedFamily(page);
  const pages = [
    '/dashboard',
    '/members',
    `/members/${fam.people['kwame']}`,
    `/members/${fam.people['kwame']}/edit`,
    '/members/new',
    '/tree',
    '/family/settings',
    '/families/new',
    '/settings',
  ];
  const overflowing: string[] = [];
  for (const path of pages) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
    if (scroll > width + 1) overflowing.push(`${path}: ${scroll}px wide on a ${width}px screen`);
  }
  expect(overflowing).toEqual([]);

  // Navigation lives in a drawer on phones.
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('dialog', { name: 'Navigation' }).getByRole('link', { name: 'Family Tree' }).click();
  await expect(page).toHaveURL(/\/tree/);
  await expect(page.locator('fh-tree-canvas')).toBeVisible();
});
