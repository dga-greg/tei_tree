import { expect, test, type Page } from '@playwright/test';
import { api, files, seedFamily, signUp } from './support';

async function upload(page: Page, familyId: string, file: { name: string; mimeType: string; buffer: Buffer }, fields: Record<string, string> = {}) {
  const xsrf = (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '';
  const res = await page.request.post(`/api/v1/families/${familyId}/media`, { multipart: { file, ...fields }, headers: { 'X-XSRF-TOKEN': xsrf } });
  expect(res.status()).toBe(201);
}

test('record places and see where the family moved; tag people in a photo; type a transcript', async ({ page }) => {
  await signUp(page, 'Ama Mensah');
  const fam = await seedFamily(page);
  const call = api(page);
  const setPlaces = async (id: string, fields: Record<string, string>) => {
    const p = await call<{ version: number }>('GET', `/families/${fam.id}/members/${id}`);
    await call('PATCH', `/families/${fam.id}/members/${id}`, { ...fields, version: p.version });
  };
  await setPlaces(fam.people['kofi']!, { birthPlace: 'Kumasi, Ashanti', deathPlace: 'Accra' });
  await setPlaces(fam.people['kwame']!, { birthPlace: 'Accra' });
  await setPlaces(fam.people['yaw']!, { birthPlace: 'Accra', hometown: 'Kumasi' });

  // Places mentioned on profiles are suggested; recording them puts them on the map.
  await page.goto('/places');
  await expect(page.getByText('No places recorded yet.')).toBeVisible();
  await page.getByRole('button', { name: /Record Kumasi as a place/ }).click();
  const dialog = page.locator('fh-place-dialog');
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Kumasi');
  await dialog.getByLabel('Region').fill('Ashanti');
  await dialog.getByLabel('Other names and spellings').fill('Kumase, Coomassie');
  await dialog.getByLabel(/Where it is on the map/).fill('6.6885, -1.6244');
  await dialog.getByRole('button', { name: 'Add place' }).click();
  await page.getByRole('button', { name: /Record Accra as a place/ }).click();
  await dialog.getByLabel(/Where it is on the map/).fill('5.6037, -0.1870');
  await dialog.getByRole('button', { name: 'Add place' }).click();

  await expect(page.getByRole('heading', { name: '2 places' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Map of 2 places and 3 movements/ })).toBeVisible();
  const moves = page.getByRole('region', { name: 'Where the family moved' });
  await expect(moves.getByText('children born away from their parents’ birthplace')).toBeVisible();
  await expect(moves.getByText('born in one, lived or died in the other')).toHaveCount(2);
  await page.getByRole('radio', { name: 'Between generations' }).click();
  await expect(moves.locator('li')).toHaveCount(1);

  await page.getByRole('link', { name: /Accra/ }).last().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Accra' })).toBeVisible();
  await expect(page.getByRole('region', { name: /Born here/ }).getByText('Kwame Mensah')).toBeVisible();
  await expect(page.getByRole('region', { name: /Born here/ }).getByText('Yaw Mensah')).toBeVisible();
  await expect(page.getByRole('region', { name: /Died here/ }).getByText('Kofi Mensah')).toBeVisible();

  // Tag Yaw in a photo by drawing a box around him.
  await upload(page, fam.id, files.png('reunion.png', 21), { title: 'Reunion' });
  await page.goto('/media');
  await page.getByRole('button', { name: /Photo: Reunion/ }).click();
  const viewer = page.locator('fh-media-viewer');
  await viewer.getByRole('button', { name: 'Tag people' }).click();
  const frame = viewer.locator('fh-photo-frame .cursor-crosshair');
  const box = (await frame.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await viewer.locator('input[role=combobox]').fill('yaw');
  await page.getByRole('option', { name: /Yaw Mensah/ }).click();
  await expect(viewer.getByText('Yaw Mensah is tagged.')).toBeVisible();
  await viewer.getByRole('button', { name: 'Done' }).click();
  await expect(viewer.locator('fh-photo-frame').getByText('Yaw Mensah')).toBeVisible();
  await viewer.getByRole('button', { name: 'Hide names' }).click();
  await expect(viewer.locator('fh-photo-frame').getByText('Yaw Mensah')).toHaveCount(0);
  await viewer.getByRole('button', { name: 'Close' }).click();

  // Type what is said in a recording, with a translation, and find it by a word in the translation.
  await upload(page, fam.id, files.wav('nana.wav'), { title: 'Nana remembers' });
  await page.goto('/media');
  await page.getByRole('button', { name: /Nana remembers/ }).click();
  await viewer.getByRole('button', { name: 'Type a transcript' }).click();
  await viewer.getByLabel('Language spoken').fill('Twi');
  await viewer.getByLabel('What is said').fill('Me nana tenaa Bekwai');
  await viewer.getByLabel('Translation', { exact: true }).fill('My grandmother lived at Bekwai');
  await viewer.getByRole('button', { name: 'Save transcript' }).click();
  await expect(viewer.getByLabel('Transcript text')).toHaveText('Me nana tenaa Bekwai');
  await expect(viewer.getByLabel('Translation text')).toHaveText('My grandmother lived at Bekwai');
  await expect(viewer.getByText(/Twi · typed by the family/)).toBeVisible();
  // No speech service in this setup, so there is no automatic option.
  await expect(viewer.getByRole('button', { name: 'Transcribe automatically' })).toHaveCount(0);
  await viewer.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('searchbox').fill('grandmother');
  await expect(page.locator('fh-media-grid li')).toHaveCount(1);
});
