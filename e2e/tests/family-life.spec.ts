import { expect, test } from '@playwright/test';
import { seedFamily, signUp } from './support';

test('record a lineage, see it inherited and in the tree; plan a ceremony; keep a fund', async ({ page }) => {
  await signUp(page, 'Ama Mensah');
  const fam = await seedFamily(page);

  // Akosua's abusua and totem, recorded once on her profile…
  await page.goto(`/members/${fam.people['akosua']}/edit`);
  await page.getByLabel('Abusua (through the mother)').fill('Oyoko');
  await page.getByLabel('Totem').fill('Parrot');
  await page.getByRole('button', { name: /Save/ }).first().click();
  await page.waitForURL(new RegExp(`/members/${fam.people['akosua']}$`));

  // …are inherited by her daughter's daughter, but not by her son's son.
  await page.goto(`/members/${fam.people['abena']}`);
  const lineage = page.getByRole('region', { name: 'Lineage' });
  await expect(lineage.getByText('Oyoko')).toBeVisible();
  await expect(lineage.getByText('Parrot')).toBeVisible();
  await expect(lineage.getByRole('link', { name: 'Akosua Owusu' }).first()).toBeVisible();
  await page.goto(`/members/${fam.people['yaw']}`);
  await expect(page.getByRole('region', { name: 'Lineage' })).toHaveCount(0);

  await page.goto('/lineage');
  const oyoko = page.getByRole('region', { name: 'Oyoko' });
  await expect(oyoko.getByText('4 people, 1 living')).toBeVisible();
  await expect(oyoko.getByText('Totem: Parrot')).toBeVisible();

  await page.goto('/tree?colour=maternal');
  await expect(page.getByRole('region', { name: 'Abusua' }).getByText('Oyoko')).toBeVisible();

  // A naming ceremony with the usual programme and a godmother who is not in the tree.
  await page.goto('/ceremonies/new');
  await page.getByLabel('Title').fill("Outdooring of Abena's daughter");
  await page.getByRole('button', { name: 'Start from a typical programme' }).click();
  await page.getByRole('button', { name: 'Add a role' }).click();
  await page.getByLabel('Role', { exact: true }).fill('Godmother');
  await page.getByLabel('Or a name').fill('Auntie Efua');
  await page.getByRole('button', { name: 'Save the ceremony' }).click();
  await expect(page.getByRole('heading', { level: 1, name: "Outdooring of Abena's daughter" })).toBeVisible();
  await expect(page.getByText('Naming and blessing with water and schnapps')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Roles' }).getByText('Auntie Efua')).toBeVisible();
  await page.goto('/ceremonies');
  await expect(page.getByText("Outdooring of Abena's daughter")).toBeVisible();

  // Monthly dues, and a contribution from Kwame.
  await page.goto('/funds');
  await page.getByRole('button', { name: 'New fund' }).click();
  const dialog = page.locator('fh-fund-dialog');
  await dialog.getByLabel('Name').fill('Monthly dues');
  await dialog.getByLabel('Amount each').fill('50');
  await dialog.getByRole('button', { name: 'Create fund' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Monthly dues' })).toBeVisible();
  await page.getByRole('button', { name: 'Record a contribution' }).click();
  const c = page.locator('fh-contribution-dialog');
  await c.locator('input[role=combobox]').fill('kwame');
  await page.getByRole('option', { name: /Kwame Mensah/ }).first().click();
  await c.getByLabel(/^Amount/).fill('50');
  await c.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('table').getByText('Kwame Mensah')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Totals' }).getByText(/50\.00/).first()).toBeVisible();
  await page.goto('/funds');
  await expect(page.getByRole('link', { name: /Monthly dues/ })).toContainText('1 contributor');
});
