import { expect, test } from '@playwright/test';
import { seedFamily, signUp } from './support';

const gedcom = [
  '0 HEAD', '1 SOUR MyHeritage', '1 GEDC', '2 VERS 5.5.1', '1 CHAR UTF-8',
  '0 @I1@ INDI', '1 NAME Kofi /Mensah/', '1 SEX M', '1 BIRT', '2 DATE ABT 1885', '2 PLAC Cape Coast', '1 DEAT', '2 DATE 1962', '1 FAMS @F1@',
  '0 @I2@ INDI', '1 NAME Kwabena /Mensah/', '1 SEX M', '1 BIRT', '2 DATE 1918', '1 DEAT', '2 DATE 1990', '1 FAMC @F1@',
  '0 @I3@ INDI', '1 NAME Quame /Mensah/', '1 SEX M', '1 BIRT', '2 DATE 1912', '1 DEAT', '2 DATE 1980', '1 FAMC @F1@',
  '0 @F1@ FAM', '1 HUSB @I1@', '1 CHIL @I2@', '1 CHIL @I3@',
  '0 TRLR',
].join('\r\n');

test('import a GEDCOM file, merge the duplicate it brings, and undo both', async ({ page }) => {
  await signUp(page, 'Ama Mensah');
  await seedFamily(page);

  await page.goto('/family/import');
  await page.getByLabel('GEDCOM file').setInputFiles({ name: 'mensah.ged', mimeType: 'text/plain', buffer: Buffer.from(gedcom) });
  await expect(page.getByRole('heading', { name: '2. Check what will be imported' })).toBeVisible();
  await expect(page.getByText('mensah.ged · from MyHeritage · GEDCOM 5.5.1')).toBeVisible();
  // Kofi is already in the family (likely match, preselected); Quame is only possibly Kwame.
  const kofi = page.getByRole('listitem').filter({ hasText: 'In the file' }).filter({ hasText: 'Kofi Mensah' });
  await expect(kofi.getByText('Likely match')).toBeVisible();
  await expect(kofi.getByRole('radio', { name: 'Same person' })).toBeChecked();
  const quame = page.getByRole('listitem').filter({ hasText: 'In the file' }).filter({ hasText: 'Quame Mensah' });
  await expect(quame.getByText('Possible match')).toBeVisible();
  await expect(quame.getByRole('radio', { name: 'Different' })).toBeChecked();

  await page.getByRole('button', { name: 'Import 2 people' }).click();
  await expect(page.getByText(/Imported 2 people, 2 parent links and 0 couples/)).toBeVisible();
  await expect(page.getByText(/joining 1 people already in the family/)).toBeVisible();

  // Kofi's empty birthplace was filled in from the file.
  await page.goto('/members');
  await page.getByRole('link', { name: /Kofi Mensah/ }).first().click();
  await expect(page.getByText('Cape Coast')).toBeVisible();

  // The import brought Quame, who is the Kwame already in the family.
  await page.goto('/members/duplicates');
  const pair = page.getByRole('listitem').filter({ hasText: 'Quame Mensah' }).filter({ hasText: 'Kwame Mensah' });
  await expect(pair.getByText('Same parent')).toBeVisible();
  await pair.getByRole('link', { name: 'Compare and merge' }).click();
  await expect(page.getByRole('heading', { name: 'Choose the details to keep' })).toBeVisible();
  await page.getByRole('button', { name: /^Merge into / }).click();
  await expect(page.getByText(/was merged into/)).toBeVisible();

  await page.goto('/members/duplicates');
  await expect(page.getByText('No likely duplicates found.')).toBeVisible();
  await page.getByRole('button', { name: 'Separate again' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Quame Mensah' }).filter({ hasText: 'Kwame Mensah' }).first()).toBeVisible();

  // Undo the whole import: Kwabena and Quame go, Kofi's birthplace is put back.
  await page.goto('/family/import');
  await page.getByRole('button', { name: 'Undo import' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Undo import' }).click();
  await expect(page.getByText('Undone')).toBeVisible();
  await page.goto('/members');
  await expect(page.getByRole('link', { name: /Kwabena Mensah/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Quame Mensah/ })).toHaveCount(0);
});
