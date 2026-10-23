import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthStore } from './auth.store';

/** Session status is resolved by an app initializer before the first navigation. */
export const authGuard: CanActivateFn = (_route, state) => {
  const store = inject(AuthStore);
  if (store.isAuthenticated()) return true;
  return inject(Router).createUrlTree(['/auth/login'], { queryParams: { returnUrl: state.url } });
};

export const guestGuard: CanActivateFn = () => {
  const store = inject(AuthStore);
  return store.isAuthenticated() ? inject(Router).createUrlTree(['/']) : true;
};

/** UI convenience only — the API enforces platform permissions on every request. */
export const superAdminGuard: CanActivateFn = () => {
  const store = inject(AuthStore);
  if (!store.isSuperAdmin()) return inject(Router).createUrlTree(['/']);
  // Administrators turn on two-step sign-in first (the API refuses them otherwise).
  const security = store.user()?.security;
  if (security?.mfaRequired && !security.mfaEnabled) return inject(Router).createUrlTree(['/settings'], { fragment: 'mfa-heading' });
  return true;
};

/** Only allows same-app relative return URLs, preventing open redirects via ?returnUrl=. */
export function safeReturnUrl(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || value.startsWith('/auth')) return '/';
  return value;
}
