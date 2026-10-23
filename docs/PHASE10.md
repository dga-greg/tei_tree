# Phase 10 — Calendar, reminders & phone app: what was built and how it was verified

## Delivered

**Family calendar** (Calendar in the menu; family members)
- Birthdays, wedding anniversaries, days of remembrance (anniversaries of deaths), optionally the birthdays
  of those who have passed ("would have turned 100"), and family events recorded with an exact date.
- Titles ready to read: "Ama Mensah's 80th birthday", "Remembering Kofi Mensah, 10 years since they passed",
  "Kwame Mensah and Esi Mensah's 50th wedding anniversary". 29 February birthdays fall on the 28th in other years.
- **Privacy**: every date comes from the viewer's own view of the profile, so children's birthdays and dates
  people chose to hide appear only for administrators (and the person); anniversaries need both partners'
  full dates; anniversaries of couples who have both died are remembered through their own remembrance days;
  people of unknown status are not given birthdays after the age of 100; guests have no calendar.
- A month grid on larger screens and a day-by-day list on phones, filters by kind (icon and label, never
  colour alone), and a **Coming up** card on the dashboard for the next 30 days.

**Reminders** (Settings → Reminders)
- Per account: weekly e-mail on or off, which kinds of day to be reminded of, and the time zone (the device's
  is offered). A preview shows what this week's e-mail would say.
- **Weekly e-mail**: for each family, the week ahead and what was added in the past week (people, photos and
  documents, stories, counted as the person may see them). Not sent when there is nothing to tell.
- **Phone notifications** (Web Push): in the morning, what is happening that day in the person's families
  ("Today in the Mensah Family: Kwame Mensah's 76th birthday, and 2 more"); tapping opens the calendar.
  Turned on per device; "Send a test"; devices that unsubscribe are forgotten automatically; at most 10 per
  account.
- Reminders go out at 07:00 (configurable) **in each person's own time zone**. An hourly run (worker
  schedule; a timer in the API without Redis; or `npm run reminders` from cron) sends what is due, and
  delivery records make every reminder go out at most once, however often or on however many workers it runs.
- Security: the server only sends to the browsers' push services (Google, Mozilla, Apple, Microsoft), so a
  subscription can never make it call other addresses; push addresses are left out of the personal data
  export; account deletion removes devices and switches reminders off.

**Installable app**
- Web app manifest (name, standalone display, start page, theme colours, shortcuts to the tree and calendar)
  and icons drawn from the logo (regular, maskable for Android, Apple touch icon, notification badge;
  `frontend/scripts/make-icons.mjs` redraws them).
- Angular service worker in production builds: caches the app itself — **never family data from the API** —
  so it opens instantly and offline, shows notifications and opens the right page when one is tapped.
- Settings offers "Install Family Heritage" where the browser supports it, and explains Share → Add to Home
  Screen on iPhone and iPad.
- nginx serves the service worker, its manifest and the icons with `Cache-Control: no-cache` so releases reach
  installed apps (they would otherwise have been cached for a year with the fingerprinted files), and the
  manifest with its proper content type.

## Verification

| Check | Result |
|---|---|
| Backend (unit + integration, real MongoDB) | **275 passing** — new: yearly dates and 29 February, titles, local time and ISO weeks across time zones; the calendar for an administrator and for a member (children's and hidden dates, anniversaries, events); preferences and their validation; only push services accepted (plain HTTP, localhost, cloud metadata address and look-alike hosts refused); test notifications; the weekly e-mail sent once a week at 07:00 local time, not sent when turned off or without a verified address; the morning notification in Auckland's time zone, once a day, unsubscribed devices removed, nothing sent on empty days |
| Web Push encryption | A stand-in push service receives the server's notification over HTTPS, checks the VAPID signature and decrypts the message as a browser does (RFC 8291): it is the Angular notification payload, unreadable in transit; "gone" (410) devices are recognised |
| Frontend unit / contracts | 28 / 23 passing |
| End-to-end (Playwright) | **17 passing** — new journey: a birthday and an event appear in "Coming up" and on the calendar, the kind filter hides birthdays, the e-mail preview lists the birthday, the weekly e-mail is turned off and stays off. The phone-screen check includes the calendar |
| Production containers | images rebuilt; full stack healthy; smoke test (15 checks) passing, including the manifest, the service worker served with `no-cache`, icons and the calendar. In a browser against the stack: the service worker installs and controls the page, and **the app opens with the network switched off** |

## Not verified here

- **Subscribing a real browser to notifications**: Chrome registers with Google's push service, which this
  environment cannot reach (headless browsers also disable push in private mode). Everything on the server
  side is verified as above; on the app side, subscribing now gives up with an explanation after 20 seconds
  instead of waiting silently.
- Lighthouse no longer has a PWA category; the installability criteria (manifest with 192 and 512 px icons,
  standalone display, start URL, a service worker controlling the page) were checked directly.
