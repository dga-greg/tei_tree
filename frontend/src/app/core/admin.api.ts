import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { AdminUpdateUserRequest, AdminUserView, ApiPage, ApiSuccess, PlatformStats } from '@fh/contracts';
import { api } from './api/api';

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);

  async stats() {
    return (await firstValueFrom(this.http.get<ApiSuccess<PlatformStats>>(api('/admin/stats')))).data;
  }

  users(query: { page: number; pageSize: number; q?: string; status?: string }) {
    let params = new HttpParams().set('page', query.page).set('pageSize', query.pageSize);
    if (query.q) params = params.set('q', query.q);
    if (query.status) params = params.set('status', query.status);
    return firstValueFrom(this.http.get<ApiPage<AdminUserView>>(api('/admin/users'), { params }));
  }

  async updateUser(id: string, body: AdminUpdateUserRequest) {
    return (await firstValueFrom(this.http.patch<ApiSuccess<AdminUserView>>(api(`/admin/users/${encodeURIComponent(id)}`), body))).data;
  }
}
