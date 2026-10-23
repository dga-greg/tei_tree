import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiSuccess, BranchView, CreateBranchRequest, TreeWindow, UpdateBranchRequest } from '@fh/contracts';
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

  branch(familyId: string, branchId: string, depth: number) {
    return this.window(`${base(familyId)}/tree/branches/${id(branchId)}`, depth);
  }

  async branches(familyId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<BranchView[]>>(`${base(familyId)}/branches`))).data;
  }

  async createBranch(familyId: string, body: CreateBranchRequest) {
    return (await firstValueFrom(this.http.post<ApiSuccess<BranchView>>(`${base(familyId)}/branches`, body))).data;
  }

  async createBranchesForFounderChildren(familyId: string) {
    return (await firstValueFrom(this.http.post<ApiSuccess<BranchView[]>>(`${base(familyId)}/branches/from-founder-children`, {}))).data;
  }

  async updateBranch(familyId: string, branchId: string, body: UpdateBranchRequest) {
    return (await firstValueFrom(this.http.patch<ApiSuccess<BranchView>>(`${base(familyId)}/branches/${id(branchId)}`, body))).data;
  }

  async removeBranch(familyId: string, branchId: string) {
    await firstValueFrom(this.http.delete<void>(`${base(familyId)}/branches/${id(branchId)}`));
  }
}
