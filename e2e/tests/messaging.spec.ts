import { expect, test } from '@playwright/test';
import { api, mailCount, mailLink, seedFamily, signUp } from './support';

test('announce a ceremony by SMS; the relative answers through the personal link and can stop messages', async ({ page, browser }) => {
  await signUp(page, 'Ama Mensah');
  const fam = await seedFamily(page);
  const call = api(page);
  // Yaw has a phone number; Abena has none and no account.
  const phone = `024${String(Date.now()).slice(-7)}`;
  const intl = `233${phone.slice(1)}`;
  const yaw = await call<{ version: number }>('GET', `/families/${fam.id}/members/${fam.people['yaw']}`);
  await call('PATCH', `/families/${fam.id}/members/${fam.people['yaw']}`, { version: yaw.version, contact: { phone } });
  const soon = new Date(Date.now() + 10 * 86_400_000);
  const ceremony = await call<{ id: string }>('POST', `/families/${fam.id}/events`, {
    kind: 'funeral',
    title: 'Funeral of Nana Kofi',
    date: { year: soon.getUTCFullYear(), month: soon.getUTCMonth() + 1, day: soon.getUTCDate(), qualifier: 'exact' },
    place: 'Kumasi',
  });

  // The family's own opening and sign-off, so relatives know which family the message is from.
  await page.goto('/family/settings');
  await page.getByLabel('Opening line').fill('From the house of {family}:');
  await page.getByLabel('Sign-off (optional)').fill('Abusua Panin');
  await expect(page.getByTestId('message-sample')).toContainText('From the house of Mensah Family:');
  await expect(page.getByTestId('message-sample')).toContainText('Abusua Panin');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();

  await page.goto(`/ceremonies/${ceremony.id}`);
  await page.getByRole('button', { name: 'Announce' }).click();
  const dialog = page.locator('fh-announce-dialog');
  await expect(dialog.getByRole('heading', { name: 'Announce “Funeral of Nana Kofi”' })).toBeVisible();
  await expect(dialog.getByLabel('Message')).toHaveValue(/Funeral of Nana Kofi\n.*Kumasi/);
  await expect(dialog.getByRole('checkbox', { name: /^SMS/ })).toBeChecked();
  const reach = dialog.getByRole('region', { name: 'Who it reaches' });
  await expect(reach.getByText('Reaches 1 person')).toBeVisible();
  await expect(reach.getByText('1 by SMS', { exact: false })).toBeVisible();
  await expect(reach.getByText('1 person cannot be reached this way')).toBeVisible();
  await expect(reach.getByTestId('announce-text')).toContainText(/^From the house of Mensah Family:\s*Funeral of Nana Kofi[\s\S]*Abusua Panin\s*Are you coming\? Answer here: \S+\/r\/…$/);
  await expect(dialog.getByRole('link', { name: 'Share on WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/\?text=From%20the%20house%20of%20Mensah%20Family%3A%0AFuneral%20of%20Nana%20Kofi[^]*Abusua%20Panin$/);

  const before = mailCount(intl, '/r/');
  await dialog.getByRole('button', { name: 'Send to 1 person' }).click();
  await expect(page.getByText('The announcement is on its way to 1 person.')).toBeVisible();
  const link = await mailLink(intl, '/r/', before);

  // Yaw opens the link on his phone, without an account.
  const context = await browser.newContext();
  const phonePage = await context.newPage();
  await phonePage.goto(link);
  await expect(phonePage.getByRole('heading', { level: 1, name: 'Funeral of Nana Kofi' })).toBeVisible();
  await expect(phonePage.getByText('Yaw, are you coming?')).toBeVisible();
  await phonePage.getByRole('button', { name: 'Yes, I am coming' }).click();
  await expect(phonePage.getByText('Thank you. The family knows you are coming.')).toBeVisible();
  await phonePage.getByRole('button', { name: 'Stop SMS and WhatsApp messages from this family' }).click();
  await expect(phonePage.getByText('You will not get SMS or WhatsApp messages from this family.')).toBeVisible();
  await phonePage.getByRole('button', { name: 'Get messages again' }).click();
  await expect(phonePage.getByRole('button', { name: 'Stop SMS and WhatsApp messages from this family' })).toBeVisible();
  await context.close();

  // The organiser sees the answer.
  await page.reload();
  const section = page.getByRole('region', { name: 'Announcements' });
  await expect(section.getByText('1 coming')).toBeVisible();
  await expect(section.getByText('1 by SMS', { exact: false })).toBeVisible();
  await section.getByRole('button', { name: 'Show people' }).click();
  await expect(section.getByRole('list', { name: 'People it went to' })).toContainText('Yaw Mensah');
  await expect(section.getByRole('list', { name: 'People it went to' })).toContainText('Coming');
});
