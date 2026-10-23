import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  AdminFamilyView,
  ApiPage,
  ApiSuccess,
  CreateFamilyRequest,
  FamilySummary,
  FamilyView,
  SetFounderRequest,
  UpdateFamilyRequest,
} from '@fh/contracts';
import { api } from '../api/api';

const family = (id: string) => api(`/families/${encodeURIComponent(id)}`);

@Injectable({ providedIn: 'root' })
export class FamiliesApi {
  private readonly http = inject(HttpClient);

  async listMine() {
    return (await firstValueFrom(this.http.get<ApiSuccess<FamilySummary[]>>(api('/families')))).data;
  }

  async get(familyId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<FamilyView>>(family(familyId)))).data;
  }

  async create(body: CreateFamilyRequest) {
    return (await firstValueFrom(this.http.post<ApiSuccess<FamilyView>>(api('/families'), body))).data;
  }

  async update(familyId: string, body: UpdateFamilyRequest) {
    return (await firstValueFrom(this.http.patch<ApiSuccess<FamilyView>>(family(familyId), body))).data;
  }

  async setFounder(familyId: string, body: SetFounderRequest) {
    return (await firstValueFrom(this.http.put<ApiSuccess<FamilyView>>(`${family(familyId)}/founder`, body))).data;
  }

  adminList(query: { page: number; pageSize: number; q?: string }) {
    const params: Record<string, string | number> = { page: query.page, pageSize: query.pageSize };
    if (query.q) params['q'] = query.q;
    return firstValueFrom(this.http.get<ApiPage<AdminFamilyView>>(api('/admin/families'), { params }));
  }

  async adminSetStatus(familyId: string, status: AdminFamilyView['status']) {
    await firstValueFrom(this.http.patch<void>(api(`/admin/families/${encodeURIComponent(familyId)}`), { status }));
  }
}
