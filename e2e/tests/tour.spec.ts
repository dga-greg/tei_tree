import { expect, test } from '@playwright/test';
import { api, signUp } from './support';

// Without the setting that switches the tour off for the other tests.
test.use({ storageState: { cookies: [], origins: [] } });

test('a new member is shown around once, and can take the tour again', async ({ page }) => {
  await signUp(page, 'Esi Tour');
  await api(page)('POST', '/families', { name: 'Tour Family', founder: { firstName: 'Nana', surname: 'Tour', gender: 'female', vitalStatus: 'deceased' } });
  await page.goto('/dashboard');

  // Only the founder so far: the dashboard says how to start.
  await expect(page.getByTestId('start-tree')).toBeVisible();

  const tour = page.getByRole('dialog', { name: 'Welcome to your family archive' });
  await expect(tour).toBeVisible();
  await expect(tour).toContainText('Step 1 of 6');
  await tour.getByRole('button', { name: 'Show me around' }).click();
  for (const title of ['Your family', 'Add your relatives', 'See the family tree', 'Everything else is in the menu']) {
    const step = page.getByRole('dialog', { name: title });
    await expect(step).toBeVisible();
    await step.getByRole('button', { name: 'Next' }).click();
  }
  const last = page.getByRole('dialog', { name: 'Your account' });
  await expect(last).toContainText('Step 6 of 6');
  await last.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('dialog', { name: 'Everything else is in the menu' }).getByRole('button', { name: 'Next' }).click();
  await last.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('tour')).toBeHidden();

  // Remembered on the account, so it does not come back on this or any other device.
  await expect.poll(async () => (await api(page)<{ user: { preferences: { tourSeen: boolean } } }>('GET', '/auth/me')).user.preferences.tourSeen).toBe(true);
  await page.evaluate(() => localStorage.removeItem('fh.tourSeen'));
  await page.reload();
  await expect(page.getByTestId('start-tree')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByTestId('tour')).toBeHidden();

  // Again from the account menu, from another page; Escape leaves it.
  await page.goto('/members');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Take the tour' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('dialog', { name: 'Welcome to your family archive' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tour')).toBeHidden();

  // The tree with only the founder says how it grows.
  await page.goto('/tree');
  await expect(page.getByTestId('tree-start')).toBeVisible();
  await expect(page.getByTestId('tree-start').getByRole('link', { name: 'Add family member' })).toBeVisible();
});
