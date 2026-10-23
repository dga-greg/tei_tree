import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiSuccess, TreeWindow } from '@fh/contracts';
import { api } from '../api/api';

const base = (familyId: string) => api(`/families/${encodeURIComponent(familyId)}`);
const id = encodeURIComponent;

@Injectable({ providedIn: 'root' })
export class TreeApi {
  private readonly http = inject(HttpClient);

  private async window(url: string, depth?: number) {
    const params = depth ? { depth } : undefined;
    return (await firstValueFrom(this.http.get<ApiSuccess<TreeWindow>>(url, { params }))).data;
  }

  root(familyId: string, depth: number) {
    return this.window(`${base(familyId)}/tree/root`, depth);
  }

  children(familyId: string, memberId: string) {
    return this.window(`${base(familyId)}/tree/nodes/${id(memberId)}/children`);
  }

  descendants(familyId: string, memberId: string, depth: number) {
    return this.window(`${base(familyId)}/tree/nodes/${id(memberId)}/descendants`, depth);
  }

  ancestors(familyId: string, memberId: string, depth: number) {
    return this.window(`${base(familyId)}/tree/nodes/${id(memberId)}/ancestors`, depth);
  }
}
