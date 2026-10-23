import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiPage, ApiSuccess, CreateReportRequest, ReportStatus, ReportView, ResolveReportRequest } from '@fh/contracts';
import { api } from '../api/api';

export interface ScheduledDeletion {
  id: string;
  name: string;
  deletionScheduledFor: string;
}

/** Exports, deletion of families and accounts, and abuse reports. */
@Injectable({ providedIn: 'root' })
export class LifecycleApi {
  private readonly http = inject(HttpClient);

  /** Plain links: the browser downloads them with the session cookie (GET needs no CSRF token). */
  familyExportUrl(familyId: string, format: 'json' | 'gedcom', living: 'include' | 'private'): string {
    return `${api(`/families/${encodeURIComponent(familyId)}/export`)}?format=${format}&living=${living}`;
  }
  readonly accountExportUrl = api('/account/export');

  async scheduleFamilyDeletion(familyId: string, name: string, password: string) {
    return (await firstValueFrom(this.http.post<ApiSuccess<{ deletionScheduledFor: string }>>(api(`/families/${encodeURIComponent(familyId)}/deletion`), { name, password }))).data;
  }
  async cancelFamilyDeletion(familyId: string) {
    await firstValueFrom(this.http.delete(api(`/families/${encodeURIComponent(familyId)}/deletion`)));
  }
  async scheduledDeletions() {
    return (await firstValueFrom(this.http.get<ApiSuccess<ScheduledDeletion[]>>(api('/families/scheduled-deletions')))).data;
  }
  async deleteAccount(password: string) {
    await firstValueFrom(this.http.post(api('/account/delete'), { password }));
  }

  async report(body: CreateReportRequest) {
    return (await firstValueFrom(this.http.post<ApiSuccess<{ id: string }>>(api('/reports'), body))).data;
  }
  reports(status: ReportStatus, page = 1) {
    return firstValueFrom(this.http.get<ApiPage<ReportView>>(api('/admin/reports'), { params: new HttpParams().set('status', status).set('page', page) }));
  }
  async resolveReport(id: string, body: ResolveReportRequest) {
    return (await firstValueFrom(this.http.patch<ApiSuccess<ReportView>>(api(`/admin/reports/${encodeURIComponent(id)}`), body))).data;
  }
}
