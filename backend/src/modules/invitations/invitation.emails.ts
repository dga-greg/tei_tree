import type { MailMessage } from '../../infra/mailer.js';

export function invitationEmail(input: { to: string; familyName: string; inviter: string; roleLabel: string; message: string; url: string; expires: Date }): MailMessage {
  return {
    to: input.to,
    subject: `${input.inviter} invited you to the ${input.familyName} on Family Heritage`,
    text: [
      `Hello,`,
      '',
      `${input.inviter} has invited you to join the ${input.familyName} family tree as a ${input.roleLabel.toLowerCase()}.`,
      ...(input.message ? ['', `“${input.message}”`] : []),
      '',
      'Open this link to accept (you can sign in or create an account with this e-mail address):',
      input.url,
      '',
      `The invitation expires on ${input.expires.toUTCString()}.`,
      'If you were not expecting this, you can ignore this e-mail.',
    ].join('\n'),
  };
}
