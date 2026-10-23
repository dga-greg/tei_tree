import { expect, test } from '@playwright/test';
import { api, seedFamily, signUp } from './support';

test('register a family with its founder, add a child, and see generations and the tree', async ({ page }) => {
  await signUp(page, 'Ama Mensah');
  await page.goto('/families/new');
  await page.getByLabel('Family name').fill('Asante Family');
  await page.getByLabel('Hometown of origin').fill('Kumasi');
  await page.getByLabel('First name').fill('Nana');
  await page.getByLabel('Surname').fill('Asante');
  await page.getByRole('button', { name: 'Register family' }).click();
  await page.waitForURL(/\/(dashboard|members\/)/);

  await page.goto('/members');
  await page.getByRole('link', { name: /Nana Asante/ }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Nana Asante' })).toBeVisible();
  await page.getByRole('link', { name: 'Add a new person as children' }).click();
  await expect(page.getByText('Will be added as a child of')).toBeVisible();
  await page.getByLabel('First name').fill('Kwabena');
  await page.getByLabel('Surname').fill('Asante');
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Kwabena Asante' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Parents' }).getByText('Nana Asante')).toBeVisible();
  await expect(page.getByText('G2').first()).toBeVisible();

  await page.goto('/generations');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/tree');
  await expect(page.locator('fh-tree-canvas g[role=button][aria-label^="Nana Asante"]')).toBeVisible();
  await expect(page.locator('fh-tree-canvas g[role=button][aria-label^="Kwabena Asante"]')).toBeVisible();
});

test('the relationship finder names cousins and shows the path in the tree', async ({ page }) => {
  await signUp(page, 'Ama Mensah');
  const fam = await seedFamily(page);
  await page.goto(`/relationships?a=${fam.people['yaw']}&b=${fam.people['abena']}`);
  await expect(page.locator('#answer-h')).toHaveText("Yaw Mensah is Abena Mensah's first cousin.");
  await expect(page.getByRole('list', { name: 'Relationship path' }).getByRole('listitem')).toHaveCount(5);
  await page.getByRole('link', { name: 'Show this path in the family tree' }).click();
  await expect(page).toHaveURL(/\/tree\?path=/);
  await expect(page.locator('fh-tree-canvas g[role=button][aria-label^="Abena Mensah"]')).toBeVisible();
});

test('people are found by name, and integrity rules are explained', async ({ page }) => {
  await signUp(page, 'Ama Mensah');
  const fam = await seedFamily(page);
  await page.goto('/members');
  await page.getByRole('searchbox').first().fill('abena');
  await expect(page.getByRole('link', { name: /Abena Mensah/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Kwame Mensah/ })).toHaveCount(0);

  // A person cannot be their own ancestor.
  await page.goto(`/members/${fam.people['kofi']}`);
  await page.getByRole('button', { name: 'Link an existing person as parents' }).click();
  const dialog = page.locator('fh-relationship-dialog');
  await dialog.locator('input[role=combobox]').fill('yaw');
  await page.getByRole('option', { name: /Yaw Mensah/ }).click();
  await dialog.getByRole('button', { name: 'Save relationship' }).click();
  await expect(dialog.getByText(/ancestor|cycle|descendant/i)).toBeVisible();
});

test('people show the era they were born in, and the generations page counts each era', async ({ page }) => {
  await signUp(page, 'Ama Mensah');
  const fam = await seedFamily(page);

  // Cousins of the same family generation, born in different eras.
  await page.goto(`/members/${fam.people['abena']}`);
  await expect(page.locator('header').getByText('Baby Boomer')).toBeVisible();
  await expect(page.locator('header').getByText('G3')).toBeVisible();
  await page.goto(`/members/${fam.people['yaw']}`);
  await expect(page.locator('header').getByText('Silent Gen', { exact: true })).toHaveAttribute('title', 'Silent Generation: born 1928–1945');
  await expect(page.locator('header').getByText('G3')).toBeVisible();

  await page.goto('/generations');
  const eras = page.getByRole('region', { name: 'By era of birth' });
  await expect(eras).toBeVisible();
  const rows = eras.getByRole('listitem');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Lost Generation');
  await expect(rows.nth(1)).toContainText('Greatest Generation');
  await expect(rows.nth(1)).toContainText('2');
  await expect(eras.getByText('1 person has no known birth year and is not counted.')).toBeVisible();
});

test('with two families, the family shown at the top is the one whose figures are shown', async ({ page }) => {
  await signUp(page, 'Ama Twofamilies');
  const first = await seedFamily(page, 'Mensah Family');
  const second = await seedFamily(page, 'Owusu Family');
  const call = api(page);
  // The second family is the one this person last chose, so the app opens on it.
  await call('PATCH', '/auth/me', { preferences: { defaultFamilyId: second.id } });

  const switcher = page.locator('#family-switcher');
  const chosen = () => switcher.evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex]?.text ?? '');
  for (let i = 0; i < 3; i++) {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Owusu Family');
    await expect.poll(chosen).toBe('Owusu Family');
  }

  // Switching changes both, and the choice is remembered.
  await switcher.selectOption(first.id);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mensah Family');
  await expect.poll(chosen).toBe('Mensah Family');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mensah Family');
  await expect.poll(chosen).toBe('Mensah Family');
});
