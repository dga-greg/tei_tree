import { provideHttpClient, withFetch, withInterceptors, withXsrfConfiguration } from '@angular/common/http';
import {
  type ApplicationConfig,
  inject,
  isDevMode,
  LOCALE_ID,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, TitleStrategy, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { TranslatedTitleStrategy } from './core/i18n/title-strategy';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { FamilyContextStore } from './core/families/family-context.store';
import { GenerationsApi } from './core/generations/generations.api';
import { authRefreshInterceptor } from './core/auth/auth.interceptor';
import { timeoutInterceptor } from './core/api/timeout.interceptor';
import { AuthStore } from './core/auth/auth.store';
import { ThemeService } from './core/theme/theme.service';
import { AppInstallService } from './core/pwa/app-install.service';
import { currentLanguage } from './core/i18n/i18n';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Dates and numbers in the chosen language (see core/i18n).
    { provide: LOCALE_ID, useFactory: () => currentLanguage().formats },
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    { provide: TitleStrategy, useClass: TranslatedTitleStrategy },
    provideHttpClient(
      withFetch(),
      // Matches the backend's signed double-submit CSRF cookie/header names.
      withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' }),
      withInterceptors([timeoutInterceptor, authRefreshInterceptor]),
    ),
    // Installable app and notifications (production builds only). It caches the app itself, never API data.
    provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode(), registrationStrategy: 'registerWhenStable:30000' }),
    // Resolve the session before the first navigation so guards see the real state.
    provideAppInitializer(() => {
      inject(ThemeService);
      inject(AppInstallService);
      const auth = inject(AuthStore);
      const families = inject(FamilyContextStore);
      const generations = inject(GenerationsApi);
      // Signed in: ask for the families (and, opening on the dashboard, its figures) now, while the page's code is
      // still downloading, instead of after it.
      return auth.init().then(() => {
        if (!auth.isAuthenticated()) return;
        void families.ensureLoaded(() => {
          const family = families.active();
          if (family && /^\/(dashboard)?\/?$/.test(location.pathname)) generations.prefetchDashboard(family.id);
        });
      });
    }),
  ],
};
