import { expect, test } from '@playwright/test';
import { api, seedFamily, signUp } from './support';


test('birthdays and events appear on the dashboard and calendar; reminders can be set', async ({ page }) => {
  await signUp(page, 'Ama Mensah');
  const fam = await seedFamily(page);
  // A birthday in three days and a family event in five, so both fall within "coming up".
  const soon = new Date();
  soon.setDate(soon.getDate() + 3);
  const later = new Date();
  later.setDate(later.getDate() + 5);
  await api(page)('POST', `/families/${fam.id}/members`, {
    person: { firstName: 'Efua', surname: 'Mensah', gender: 'female', vitalStatus: 'living', birthDate: { year: 1960, month: soon.getMonth() + 1, day: soon.getDate() } },
    links: { parents: [{ memberId: fam.people['yaw'], subtype: 'biological', verification: 'verified' }] },
  });
  await api(page)('POST', `/families/${fam.id}/events`, { kind: 'reunion', title: 'Mensah family reunion', date: { year: later.getFullYear(), month: later.getMonth() + 1, day: later.getDate() }, place: 'Cape Coast', memberIds: [], privacy: 'family' });
  const age = soon.getFullYear() - 1960;

  await page.goto('/dashboard');
  const comingUp = page.getByRole('region', { name: 'Coming up' });
  await expect(comingUp.getByText(`Efua Mensah's ${age}th birthday`)).toBeVisible();
  await expect(comingUp.getByText('Mensah family reunion')).toBeVisible();

  await page.getByRole('link', { name: 'Calendar', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Family calendar' })).toBeVisible();
  // Move to the month of the birthday if it is next month.
  if (soon.getMonth() !== new Date().getMonth()) await page.getByRole('button', { name: 'Next month' }).click();
  const cell = page.getByRole('gridcell', { name: new RegExp(`^${soon.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}`) });
  await expect(cell.getByText(`Efua Mensah's ${age}th birthday`)).toBeVisible();
  await cell.click();
  await expect(page.locator('#agenda-h')).toContainText(soon.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }));
  // Filtering by kind hides birthdays.
  await page.getByText('Birthdays', { exact: true }).click();
  await expect(cell.getByText(`Efua Mensah's ${age}th birthday`)).toHaveCount(0);

  await page.goto('/settings#notifications');
  const reminders = page.getByRole('region', { name: 'Reminders' });
  await expect(reminders.getByText('Notifications are not set up on this server yet.')).toBeVisible();
  await reminders.getByRole('button', { name: "Preview this week's e-mail" }).click();
  await expect(reminders.getByText(`Efua Mensah's ${age}th birthday`)).toBeVisible();
  await reminders.getByLabel('Weekly e-mail').uncheck();
  await reminders.getByRole('button', { name: 'Save reminders' }).click();
  await expect(reminders.getByText('Reminders saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Reminders' }).getByLabel('Weekly e-mail')).not.toBeChecked();
});
