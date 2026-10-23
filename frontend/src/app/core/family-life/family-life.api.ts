import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  ApiSuccess,
  FundContributionInput,
  FundContributionView,
  FundInput,
  FundReport,
  FundView,
  LineageOverview,
  LineageSide,
  UpdateFundRequest,
} from '@fh/contracts';
import { api } from '../api/api';

const base = (familyId: string) => api(`/families/${encodeURIComponent(familyId)}`);
const id = encodeURIComponent;

/** Lineages and family funds. */
@Injectable({ providedIn: 'root' })
export class FamilyLifeApi {
  private readonly http = inject(HttpClient);

  async lineages(familyId: string, side: LineageSide) {
    return (await firstValueFrom(this.http.get<ApiSuccess<LineageOverview>>(`${base(familyId)}/lineages`, { params: new HttpParams().set('side', side) }))).data;
  }

  async funds(familyId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<FundView[]>>(`${base(familyId)}/funds`))).data;
  }
  async fund(familyId: string, fundId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<FundView>>(`${base(familyId)}/funds/${id(fundId)}`))).data;
  }
  async createFund(familyId: string, body: FundInput) {
    return (await firstValueFrom(this.http.post<ApiSuccess<FundView>>(`${base(familyId)}/funds`, body))).data;
  }
  async updateFund(familyId: string, fundId: string, body: UpdateFundRequest) {
    return (await firstValueFrom(this.http.patch<ApiSuccess<FundView>>(`${base(familyId)}/funds/${id(fundId)}`, body))).data;
  }
  async removeFund(familyId: string, fundId: string) {
    await firstValueFrom(this.http.delete(`${base(familyId)}/funds/${id(fundId)}`));
  }
  async contributions(familyId: string, fundId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<FundContributionView[]>>(`${base(familyId)}/funds/${id(fundId)}/contributions`))).data;
  }
  async addContribution(familyId: string, fundId: string, body: FundContributionInput) {
    return (await firstValueFrom(this.http.post<ApiSuccess<FundContributionView>>(`${base(familyId)}/funds/${id(fundId)}/contributions`, body))).data;
  }
  async updateContribution(familyId: string, fundId: string, contributionId: string, body: Partial<FundContributionInput>) {
    return (await firstValueFrom(this.http.patch<ApiSuccess<FundContributionView>>(`${base(familyId)}/funds/${id(fundId)}/contributions/${id(contributionId)}`, body))).data;
  }
  async removeContribution(familyId: string, fundId: string, contributionId: string) {
    await firstValueFrom(this.http.delete(`${base(familyId)}/funds/${id(fundId)}/contributions/${id(contributionId)}`));
  }
  async report(familyId: string, fundId: string, period?: string) {
    const params = period ? new HttpParams().set('period', period) : undefined;
    return (await firstValueFrom(this.http.get<ApiSuccess<FundReport>>(`${base(familyId)}/funds/${id(fundId)}/report`, { params }))).data;
  }
  async mine(familyId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<(FundContributionView & { fund: { id: string; name: string; currency: string } })[]>>(`${base(familyId)}/funds/mine`))).data;
  }
  /** A plain link: the browser downloads it with the session cookie. */
  exportUrl(familyId: string, fundId: string): string {
    return `${base(familyId)}/funds/${id(fundId)}/export`;
  }
}
