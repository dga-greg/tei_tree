import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  ApiPage,
  ApiSuccess,
  CreateMemberRequest,
  CreateRelationshipRequest,
  ListMembersQuery,
  MemberView,
  PersonCard,
  RelationshipView,
  UpdateMemberRequest,
  UpdateRelationshipRequest,
} from '@fh/contracts';
import { api } from '../api/api';

const base = (familyId: string) => api(`/families/${encodeURIComponent(familyId)}`);

function params(query: object): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
  return p;
}

@Injectable({ providedIn: 'root' })
export class MembersApi {
  private readonly http = inject(HttpClient);

  list(familyId: string, query: ListMembersQuery) {
    return firstValueFrom(this.http.get<ApiPage<PersonCard>>(`${base(familyId)}/members`, { params: params(query) }));
  }

  /** Detail names already used in the family, most used first. */
  async attributeNames(familyId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<string[]>>(`${base(familyId)}/attribute-names`))).data;
  }

  async search(familyId: string, q: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<PersonCard[]>>(`${base(familyId)}/members/search`, { params: params({ q }) }))).data;
  }

  async get(familyId: string, memberId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<MemberView>>(`${base(familyId)}/members/${encodeURIComponent(memberId)}`))).data;
  }

  async create(familyId: string, body: CreateMemberRequest) {
    return (await firstValueFrom(this.http.post<ApiSuccess<MemberView>>(`${base(familyId)}/members`, body))).data;
  }

  async update(familyId: string, memberId: string, body: UpdateMemberRequest) {
    return (await firstValueFrom(this.http.patch<ApiSuccess<MemberView>>(`${base(familyId)}/members/${encodeURIComponent(memberId)}`, body))).data;
  }

  async remove(familyId: string, memberId: string) {
    await firstValueFrom(this.http.delete<void>(`${base(familyId)}/members/${encodeURIComponent(memberId)}`));
  }

  async addRelationship(familyId: string, body: CreateRelationshipRequest) {
    return (await firstValueFrom(this.http.post<ApiSuccess<RelationshipView>>(`${base(familyId)}/relationships`, body))).data;
  }

  async getRelationship(familyId: string, id: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<RelationshipView>>(`${base(familyId)}/relationships/${encodeURIComponent(id)}`))).data;
  }

  async updateRelationship(familyId: string, id: string, body: UpdateRelationshipRequest) {
    return (await firstValueFrom(this.http.patch<ApiSuccess<RelationshipView>>(`${base(familyId)}/relationships/${encodeURIComponent(id)}`, body))).data;
  }

  async removeRelationship(familyId: string, id: string) {
    await firstValueFrom(this.http.delete<void>(`${base(familyId)}/relationships/${encodeURIComponent(id)}`));
  }

  /** How two people are related (kinship term, path, common ancestors). */

}
