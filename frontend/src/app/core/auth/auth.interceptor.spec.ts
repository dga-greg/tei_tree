import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { authRefreshInterceptor } from './auth.interceptor';
import { AuthStore } from './auth.store';

const user = {
  id: 'u1',
  email: 'kofi@example.org',
  displayName: 'Kofi',
  platformRole: 'user',
  emailVerified: false,
  preferences: { locale: 'en', theme: 'system', defaultFamilyId: null, tourSeen: false },
  security: { hasPassword: true, mfaEnabled: false, mfaRequired: false, google: null },
  session: { idleTimeoutMinutes: null },
  createdAt: '2026-01-01T00:00:00.000Z',
} as const;

const unauthenticated = { error: { code: 'SESSION_EXPIRED', message: 'expired' } };

describe('authRefreshInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let store: AuthStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authRefreshInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AuthStore);
    store.setUser({ ...user });
  });

  afterEach(() => backend.verify());

  it('refreshes once for concurrent 401s and retries each request', async () => {
    const a = firstValueFrom(http.get('/api/v1/families'));
    const b = firstValueFrom(http.get('/api/v1/auth/sessions'));

    backend.expectOne('/api/v1/families').flush(unauthenticated, { status: 401, statusText: 'Unauthorized' });
    backend.expectOne('/api/v1/auth/sessions').flush(unauthenticated, { status: 401, statusText: 'Unauthorized' });

    const refresh = backend.match('/api/v1/auth/refresh');
    expect(refresh).toHaveLength(1);
    refresh[0]!.flush({ data: { user } });

    backend.expectOne('/api/v1/families').flush({ data: [] });
    backend.expectOne('/api/v1/auth/sessions').flush({ data: [] });
    await expect(a).resolves.toEqual({ data: [] });
    await expect(b).resolves.toEqual({ data: [] });
  });

  it('ends the session when the refresh fails', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const request = firstValueFrom(http.get('/api/v1/families'));
    backend.expectOne('/api/v1/families').flush(unauthenticated, { status: 401, statusText: 'Unauthorized' });
    backend.expectOne('/api/v1/auth/refresh').flush(unauthenticated, { status: 401, statusText: 'Unauthorized' });

    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(store.status()).toBe('anonymous');
    expect(navigate).toHaveBeenCalledWith(['/auth/login'], expect.objectContaining({ queryParams: expect.objectContaining({ reason: 'expired' }) }));
  });

  it('never tries to refresh after a failed login', async () => {
    const request = firstValueFrom(http.post('/api/v1/auth/login', {}));
    backend
      .expectOne('/api/v1/auth/login')
      .flush({ error: { code: 'UNAUTHENTICATED', message: 'no' } }, { status: 401, statusText: 'Unauthorized' });
    await expect(request).rejects.toMatchObject({ status: 401 });
    backend.expectNone('/api/v1/auth/refresh');
  });

  it('passes through errors that are not authentication failures', async () => {
    const request = firstValueFrom(http.get('/api/v1/admin/users'));
    backend.expectOne('/api/v1/admin/users').flush({ error: { code: 'FORBIDDEN', message: 'no' } }, { status: 403, statusText: 'Forbidden' });
    await expect(request).rejects.toMatchObject({ status: 403 });
    backend.expectNone('/api/v1/auth/refresh');
  });
});
