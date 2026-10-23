import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { loadLanguage } from './app/core/i18n/i18n';

// Signed in on this device: fetch the app shell (and the dashboard, when that is where we are going) now, alongside
// the language and the session check, instead of after them. The router's own import() then finds them loaded.
try {
  if (localStorage.getItem('fh.signedIn')) {
    void import('./app/layout/shell.component');
    if (/^\/(dashboard)?\/?$/.test(location.pathname)) void import('./app/features/dashboard/dashboard.page');
  }
} catch {
  /* storage unavailable: the router fetches them when needed */
}

// The language is settled before anything renders, so every text is looked up once.
loadLanguage()
  .then(() => bootstrapApplication(App, appConfig))
  .catch((err) => console.error(err));
