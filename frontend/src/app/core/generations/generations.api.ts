import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  ApiSuccess,
  FamilyDashboard,
  GenerationConflictView,
  GenerationOverrideRequest,
  GenerationSummary,
  GenerationTrendPoint,
  MemberView,
} from '@fh/contracts';
import { api } from '../api/api';

const base = (familyId: string) => api(`/families/${encodeURIComponent(familyId)}`);

@Injectable({ providedIn: 'root' })
export class GenerationsApi {
  private readonly http = inject(HttpClient);

  async summary(familyId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<GenerationSummary>>(`${base(familyId)}/generations`))).data;
  }

  async trend(familyId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<GenerationTrendPoint[]>>(`${base(familyId)}/generations/stats`))).data;
  }

  async conflicts(familyId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<GenerationConflictView[]>>(`${base(familyId)}/generations/conflicts`))).data;
  }

  async recalculate(familyId: string) {
    return (await firstValueFrom(this.http.post<ApiSuccess<GenerationSummary>>(`${base(familyId)}/generations/recalculate`, {}))).data;
  }

  async resolve(familyId: string, memberId: string, body: GenerationOverrideRequest) {
    return (await firstValueFrom(this.http.put<ApiSuccess<MemberView>>(`${base(familyId)}/members/${encodeURIComponent(memberId)}/generation-override`, body))).data;
  }

  async clearResolution(familyId: string, memberId: string) {
    return (await firstValueFrom(this.http.delete<ApiSuccess<MemberView>>(`${base(familyId)}/members/${encodeURIComponent(memberId)}/generation-override`))).data;
  }

  /** A dashboard asked for at start-up, before its page's code had arrived; taken by the page's first request. */
  private early: { familyId: string; data: Promise<FamilyDashboard>; at: number } | null = null;

  /** Start-up on the dashboard: fetches its figures while the page's code is still downloading. */
  prefetchDashboard(familyId: string): void {
    const data = this.fetchDashboard(familyId);
    data.catch(() => undefined);
    this.early = { familyId, data, at: Date.now() };
  }

  dashboard(familyId: string): Promise<FamilyDashboard> {
    const early = this.early;
    this.early = null;
    if (early && early.familyId === familyId && Date.now() - early.at < 30_000) return early.data;
    return this.fetchDashboard(familyId);
  }

  private async fetchDashboard(familyId: string): Promise<FamilyDashboard> {
    return (await firstValueFrom(this.http.get<ApiSuccess<FamilyDashboard>>(`${base(familyId)}/dashboard`))).data;
  }
}
