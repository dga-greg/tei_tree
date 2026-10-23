import { expect, test, type Page } from '@playwright/test';
import { api, seedFamily, signUp } from './support';

const code = (page: Page) => page.locator('header [data-testid=family-code]');

test('register a family with its head, add a child, and see family IDs on the profile and in the tree', async ({ page }) => {
  await signUp(page, 'Ama Mensah');
  await page.goto('/families/new');
  await page.getByLabel('Family name').fill('Asante Family');
  await page.getByLabel('Hometown of origin').fill('Kumasi');
  await page.getByLabel('First name').fill('Nana');
  await page.getByLabel('Surname').fill('Asante');
  await page.getByRole('button', { name: 'Register family' }).click();
  await page.waitForURL(/\/members\//);
  await expect(page.getByRole('heading', { level: 1, name: 'Nana Asante' })).toBeVisible();
  await expect(code(page)).toHaveText('G1');

  await page.getByRole('link', { name: 'Add a new person as children' }).click();
  await expect(page.getByText('Will be added as a child of')).toBeVisible();
  await page.getByLabel('First name').fill('Kwabena');
  await page.getByLabel('Surname').fill('Asante');
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Kwabena Asante' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Parents' }).getByText('Nana Asante')).toBeVisible();
  await expect(code(page)).toHaveText('G1.1');

  await page.goto('/tree');
  await expect(page.locator('fh-tree-canvas g[role=button][aria-label^="Nana Asante"]')).toHaveAttribute('aria-label', /G1 · Family head/);
  await expect(page.locator('fh-tree-canvas g[role=button][aria-label^="Kwabena Asante"]')).toHaveAttribute('aria-label', /G1\.1/);
});

test('a person’s status, date of death and other details are recorded and shown', async ({ page }) => {
  await signUp(page, 'Ama Mensah');
  const fam = await seedFamily(page);
  await page.goto(`/members/${fam.people['yaw']}/edit`);
  await page.getByLabel('Common name').fill('Papa Yaw');
  await page.getByLabel('Place of stay').fill('Accra');

  // The date of death is asked for only once "Deceased" is chosen.
  await expect(page.getByLabel('Date of death: year')).toHaveCount(0);
  await page.getByText('Deceased', { exact: true }).click();
  await page.getByLabel('Date of death: year').fill('2019');

  await page.getByRole('button', { name: 'Add a detail' }).click();
  await page.getByLabel('Detail 1', { exact: true }).fill('Occupation');
  await page.getByLabel('Value of detail 1').fill('Teacher');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Yaw Mensah' })).toBeVisible();
  const details = page.getByRole('region', { name: 'Details', exact: true });
  await expect(details).toContainText('Papa Yaw');
  await expect(details).toContainText('Accra');
  await expect(details).toContainText('2019');
  await expect(page.getByTestId('attributes')).toContainText('Occupation');
  await expect(page.getByTestId('attributes')).toContainText('Teacher');

  // The detail's name is offered for the next person.
  await page.goto(`/members/${fam.people['abena']}/edit`);
  await page.getByRole('button', { name: 'Add a detail' }).click();
  await expect(page.locator('#attribute-names option[value="Occupation"]')).toHaveCount(1);
});

test('people are found by name or family ID, and integrity rules are explained', async ({ page }) => {
  await signUp(page, 'Ama Mensah');
  const fam = await seedFamily(page);
  await page.goto('/members');
  const search = page.getByLabel('Search by name or family ID');
  await search.fill('abena');
  await expect(page.getByRole('link', { name: /Abena Mensah/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Kwame Mensah/ })).toHaveCount(0);

  // An ID finds that person and everyone below them.
  await search.fill('G1.2');
  await expect(page.getByRole('link', { name: /Ama Mensah/ })).toBeVisible();
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
