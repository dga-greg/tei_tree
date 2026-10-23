# Ceremony announcements: SMS, WhatsApp, e-mail and app notifications

Organisers announce a ceremony from its page (**Announce**). They choose who gets it (everyone, a branch, or
chosen people; living relatives only), how (SMS, WhatsApp, e-mail, app notification) and the message, and
see before sending who it reaches, who cannot be reached, and the SMS cost.

- **Which family it is from:** all families send through the same SMS sender ID and e-mail address, so every
  message carries the family's own **opening line** (default `{family} announcement:`) and an optional **sign-off**
  (e.g. `Abusua Panin, Opanyin Kofi Mensah`), set by family administrators in **Family settings → Announcements**
  (`{family}` stands for the family name). SMS and e-mail read: opening, message, sign-off, then the personal link;
  the e-mail subject is `<family>: <ceremony>`, the app notification's title starts with the family name, and the
  WhatsApp template's message part carries the opening and sign-off on one line. The announce window shows the
  exact text before sending, and both lines count towards the SMS length.
- **Who may send:** family administrators and moderators, and the people named in a role at that ceremony.
- **Personal links:** each person gets their own link to say "Yes, I am coming" or "I can't make it", without an
  account. The organiser sees the answers on the ceremony page. On the same page people can **stop SMS and
  WhatsApp messages** from the family (and turn them on again); that choice holds for later announcements.
- **Reminder:** for ceremonies with a full date, a reminder the day before (09:00) to everyone who has not
  declined.
- **Night:** messages written between 21:00 and 07:00 (Ghana time, `MESSAGING_TIMEZONE`) wait until 07:00.
- **Limits:** each family may send `SMS_MONTHLY_LIMIT_PER_FAMILY` SMS parts a month (default 2,000). One part is
  160 characters (70 when the text uses letters such as ɛ or ɔ); the link adds about 50.
- **Share on WhatsApp** (in the announce window) needs no setup: it opens WhatsApp with the message, to post in the
  family group.
- Phone numbers are the ones on people's profiles (local numbers like 024 412 3456 are read as Ghanaian). Only
  administrators see them; the ceremony page shows the last three digits.

## SMS with GiantSMS

Put the account details in `backend/.env` (locally) or as Heroku config vars (never in the code):

```
GIANT_AUTH=<the API token, as shown in the GiantSMS dashboard>
GIANT_SENDER_ID=<your approved sender ID, e.g. MyFamily>
GIANT_USERNAME=<account username>
GIANT_PASSWORD=<account password>
SMS_PRICE_PESEWAS=3        # your price per SMS, for the estimate shown before sending
```

Restart the API and the worker. The SMS option then appears in the announce window. The sender ID must be
approved by GiantSMS before messages are delivered. To try everything without sending real SMS, set
`SMS_PROVIDER=log`: messages are written to the API log instead.

## WhatsApp (optional)

WhatsApp only allows messages started by a business with a template that Meta has approved.

1. In [Meta for Developers](https://developers.facebook.com/), create an app with WhatsApp, verify the business, and
   add the phone number that will send the messages.
2. Create a message template named `family_announcement`, category **Utility**, language English, with this body:
   `Hello {{1}}, {{2}} Answer or stop messages here: {{3}}`
3. Create a permanent access token (a system user token) with WhatsApp permissions.
4. Set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (and `WHATSAPP_TEMPLATE` / `WHATSAPP_TEMPLATE_LANGUAGE` if you
   named it differently), and restart.

Meta charges per message; see its pricing for Ghana.
