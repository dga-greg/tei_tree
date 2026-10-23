import { describe, expect, it } from 'vitest';
import { composeAnnouncement, composeAnnouncementLine, DEFAULT_MESSAGE_TEMPLATE } from './announcements.js';

describe('announcement text', () => {
  const link = 'Are you coming? Answer here: https://example.org/r/abc';

  it('opens with the family name by default', () => {
    expect(composeAnnouncement({ template: DEFAULT_MESSAGE_TEMPLATE, familyName: 'Mensah Family', message: 'The funeral is on 4 May.', linkLine: link })).toBe(
      `Mensah Family announcement:\nThe funeral is on 4 May.\n${link}`,
    );
  });

  it('uses the family’s own opening and sign-off', () => {
    const template = { opening: 'From the house of {family}', signOff: 'Abusua Panin, Kofi {family}' };
    expect(composeAnnouncement({ template, familyName: 'Mensah', message: '  Meeting on Sunday. ', linkLine: link })).toBe(
      `From the house of Mensah\nMeeting on Sunday.\nAbusua Panin, Kofi Mensah\n${link}`,
    );
  });

  it('leaves out empty lines', () => {
    expect(composeAnnouncement({ template: { opening: '', signOff: '' }, familyName: 'Mensah', message: 'Hi', linkLine: link })).toBe(`Hi\n${link}`);
  });

  it('puts everything on one line for WhatsApp', () => {
    const template = { opening: '{family} announcement:', signOff: 'Abusua Panin' };
    expect(composeAnnouncementLine({ template, familyName: 'Mensah Family', message: 'The funeral\nis on 4 May.' })).toBe('Mensah Family announcement: The funeral is on 4 May. Abusua Panin');
  });
});
