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
    '/generations',
    '/branches',
    `/relationships?a=${fam.people['yaw']}&b=${fam.people['abena']}`,
    '/history',
    '/history?tab=stories',
    '/history/stories/new',
    '/media',
    '/contributions',
    '/invitations',
    '/family/members',
    '/family/history',
    '/family/settings',
    '/calendar',
    '/lineage',
    '/places',
    '/book',
    '/ceremonies',
    '/ceremonies/new',
    '/funds',
    '/family/import',
    '/members/duplicates',
    `/members/${fam.people['yaw']}/merge?with=${fam.people['abena']}`,
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
