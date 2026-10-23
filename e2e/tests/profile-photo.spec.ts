import { expect, test, type Page } from '@playwright/test';
import { seedFamily, signUp } from './support';

/** A 300×200 picture drawn in the browser, so the crop has something to work with. */
async function picture(page: Page, color: string) {
  const data = await page.evaluate((fill) => {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 200;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 300, 200);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(150, 90, 50, 0, Math.PI * 2);
    ctx.fill();
    return c.toDataURL('image/png').split(',')[1]!;
  }, color);
  return { name: 'portrait.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
}

async function crop(page: Page) {
  const dialog = page.locator('fh-photo-crop-dialog');
  await expect(dialog.getByRole('heading', { name: 'Crop the photo' })).toBeVisible();
  const area = dialog.getByRole('img');
  const box = (await area.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await dialog.getByRole('button', { name: 'Zoom in' }).click();
  await dialog.getByRole('button', { name: 'Use this photo' }).click();
  await expect(dialog).toHaveCount(0);
}

test('add a person with a photo, change it from their page, and remove it', async ({ page }) => {
  await signUp(page, 'Ama Mensah');
  const fam = await seedFamily(page);

  await page.goto(`/members/${fam.people['kwame']}`);
  await page.getByRole('link', { name: 'Add a new person as children' }).click();
  await page.getByTestId('profile-photo-input').setInputFiles(await picture(page, '#2b6c48'));
  await crop(page);
  await expect(page.locator('fh-profile-photo-field fh-person-avatar img')).toHaveAttribute('src', /^blob:/);
  await expect(page.getByText('Change photo')).toBeVisible();
  await page.getByLabel('First name').fill('Esi');
  await page.getByLabel('Surname').fill('Mensah');
  await page.getByRole('button', { name: 'Add person' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Esi Mensah' })).toBeVisible();
  const avatar = page.locator('header fh-person-avatar img');
  await expect(avatar).toHaveAttribute('src', /\/media\/[a-f0-9]+\/content\?variant=thumb&ngsw-bypass=1$/);
  await expect.poll(() => avatar.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  const first = await avatar.getAttribute('src');

  // Straight from the profile.
  await page.locator('header').getByTestId('profile-photo-input').setInputFiles(await picture(page, '#8f6a0c'));
  await crop(page);
  await expect(page.getByText("This is now Esi Mensah's profile photo.")).toBeVisible();
  await expect(avatar).not.toHaveAttribute('src', first!);

  // Both photos are in the archive, tagged with her.
  await expect(page.locator('fh-media-grid').getByRole('button', { name: /Profile photo of Esi Mensah/ })).toHaveCount(2);

  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Remove photo' }).click();
  await expect(page.getByText('Add photo')).toBeVisible();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Esi Mensah' })).toBeVisible();
  await expect(page.locator('header fh-person-avatar img')).toHaveCount(0);
  await expect(page.locator('header fh-person-avatar')).toHaveText('EM');
});
