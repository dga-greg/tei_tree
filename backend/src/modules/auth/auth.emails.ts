import type { MailMessage } from '../../infra/mailer.js';

export function passwordResetEmail(to: string, displayName: string, resetUrl: string, ttlMinutes: number): MailMessage {
  return {
    to,
    subject: 'Reset your Family Heritage password',
    text: [
      `Hello ${displayName},`,
      '',
      'We received a request to reset the password for your Family Heritage account.',
      `Open this link within ${ttlMinutes} minutes to choose a new password:`,
      '',
      resetUrl,
      '',
      'If you did not ask for this, you can ignore this e-mail — your password will not change.',
    ].join('\n'),
  };
}

export function passwordChangedEmail(to: string, displayName: string): MailMessage {
  return {
    to,
    subject: 'Your Family Heritage password was changed',
    text: [
      `Hello ${displayName},`,
      '',
      'The password for your Family Heritage account was just changed and all other sessions were signed out.',
      'If this was not you, reset your password immediately and contact your family administrator.',
    ].join('\n'),
  };
}

export function verifyEmailEmail(to: string, displayName: string, url: string): MailMessage {
  return {
    to,
    subject: 'Confirm your e-mail address for Family Heritage',
    text: [
      `Hello ${displayName},`,
      '',
      'Please confirm that this is your e-mail address by opening the link below (valid for 3 days):',
      '',
      url,
      '',
      'Confirming your address lets you accept invitations to family trees and claim your own profile.',
      'If you did not create an account, you can ignore this e-mail.',
    ].join('\n'),
  };
}

function notice(to: string, displayName: string, subject: string, lines: string[]): MailMessage {
  return { to, subject, text: [`Hello ${displayName},`, '', ...lines].join('\n') };
}

export function mfaEnabledEmail(to: string, displayName: string): MailMessage {
  return notice(to, displayName, 'Two-step sign-in is on for your Family Heritage account', [
    'Two-step sign-in was just turned on. From now on, signing in also asks for a code from your authenticator app.',
    'Keep your recovery codes somewhere safe: they let you in if you lose your phone.',
    'Other devices were signed out. If this was not you, reset your password immediately.',
  ]);
}

export function mfaDisabledEmail(to: string, displayName: string): MailMessage {
  return notice(to, displayName, 'Two-step sign-in was turned off', [
    'Two-step sign-in was just turned off for your Family Heritage account. Signing in now needs only your password.',
    'If this was not you, reset your password immediately and turn two-step sign-in back on.',
  ]);
}

export function recoveryCodeUsedEmail(to: string, displayName: string, left: number): MailMessage {
  return notice(to, displayName, 'A recovery code was used to sign in', [
    `A recovery code was just used to sign in to your Family Heritage account. ${left} ${left === 1 ? 'code is' : 'codes are'} left.`,
    left <= 3 ? 'Make new recovery codes in Settings → Security soon.' : 'Each code works once.',
    'If this was not you, reset your password immediately.',
  ]);
}

export function googleLinkedEmail(to: string, displayName: string, googleEmail: string): MailMessage {
  return notice(to, displayName, 'A Google account can now sign in to Family Heritage', [
    `The Google account ${googleEmail} was linked to your Family Heritage account and can now be used to sign in.`,
    'If this was not you, remove it in Settings → Security and reset your password.',
  ]);
}
