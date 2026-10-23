import type { MailMessage } from '../../infra/mailer.js';

export function contributionDecisionEmail(input: { to: string; name: string; familyName: string; summary: string; outcome: 'approved' | 'rejected' | 'needs_clarification'; note: string; url: string }): MailMessage {
  const what =
    input.outcome === 'approved' ? 'has been approved and is now part of the family tree' : input.outcome === 'rejected' ? 'was not accepted' : 'needs more information';
  return {
    to: input.to,
    subject: `Your suggestion for the ${input.familyName} ${input.outcome === 'needs_clarification' ? 'needs more information' : input.outcome === 'approved' ? 'was approved' : 'was not accepted'}`,
    text: [`Hello ${input.name},`, '', `Your suggestion “${input.summary}” ${what}.`, ...(input.note ? ['', `Reviewer's note: ${input.note}`] : []), '', input.url].join('\n'),
  };
}
