import { Injectable, inject } from '@angular/core';
import { Observable, finalize, map, shareReplay } from 'rxjs';
import { AuthApi } from './auth.api';
import { AuthStore } from './auth.store';

/** Ensures concurrent 401s trigger exactly one refresh request; everyone waits for the same result. */
@Injectable({ providedIn: 'root' })
export class SessionRefresher {
  private readonly authApi = inject(AuthApi);
  private readonly store = inject(AuthStore);
  private inFlight: Observable<void> | null = null;

  refresh(): Observable<void> {
    this.inFlight ??= this.authApi.refresh().pipe(
      map((res) => this.store.setUser(res.data.user)),
      finalize(() => (this.inFlight = null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.inFlight;
  }
}
