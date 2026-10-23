import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiSuccess, PublicConfig } from '@fh/contracts';
import { api } from '../api/api';

const FALLBACK: PublicConfig = { mapTiles: null, transcription: false, google: false };

/** What the server offers (map tiles, automatic transcription), fetched once. */
@Injectable({ providedIn: 'root' })
export class PublicConfigService {
  private readonly http = inject(HttpClient);
  private pending: Promise<PublicConfig> | null = null;

  get(): Promise<PublicConfig> {
    this.pending ??= firstValueFrom(this.http.get<ApiSuccess<PublicConfig>>(api('/config')))
      .then((r) => r.data)
      .catch(() => {
        this.pending = null;
        return FALLBACK;
      });
    return this.pending;
  }
}
