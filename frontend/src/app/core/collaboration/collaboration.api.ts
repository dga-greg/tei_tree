import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  AcceptInvitationResult,
  ApiPage,
  ApiSuccess,
  AuditEntryView,
  ContributionStatus,
  ContributionView,
  CreateInvitationRequest,
  InvitationPreview,
  InvitationView,
  PendingInvitation,
  MembershipView,
  PersonCard,
  RestoreResult,
  ReviewContributionRequest,
  SubmitContributionRequest,
  UpdateMembershipRequest,
} from '@fh/contracts';
import { api } from '../api/api';

const base = (familyId: string) => api(`/families/${encodeURIComponent(familyId)}`);
const id = encodeURIComponent;

@Injectable({ providedIn: 'root' })
export class CollaborationApi {
  private readonly http = inject(HttpClient);

  private async data<T>(req: ReturnType<HttpClient['get']>): Promise<T> {
    return ((await firstValueFrom(req)) as ApiSuccess<T>).data;
  }

  // invitations
  invitations(familyId: string) {
    return this.data<InvitationView[]>(this.http.get(`${base(familyId)}/invitations`));
  }
  invite(familyId: string, body: CreateInvitationRequest) {
    return this.data<InvitationView>(this.http.post(`${base(familyId)}/invitations`, body));
  }
  resendInvitation(familyId: string, invitationId: string) {
    return this.data<InvitationView>(this.http.post(`${base(familyId)}/invitations/${id(invitationId)}/resend`, {}));
  }
  async revokeInvitation(familyId: string, invitationId: string) {
    await firstValueFrom(this.http.delete(`${base(familyId)}/invitations/${id(invitationId)}`));
  }
  previewInvitation(token: string) {
    return this.data<InvitationPreview>(this.http.post(api('/invitations/preview'), { token }));
  }
  /** Pending invitations to the signed-in person's confirmed address. */
  myInvitations() {
    return this.data<PendingInvitation[]>(this.http.get(api('/invitations/mine')));
  }
  acceptMyInvitation(invitationId: string) {
    return this.data<AcceptInvitationResult>(this.http.post(api(`/invitations/${id(invitationId)}/accept`), {}));
  }
  acceptInvitation(token: string) {
    return this.data<AcceptInvitationResult>(this.http.post(api('/invitations/accept'), { token }));
  }

  // contributions
  contributions(familyId: string, query: { status?: ContributionStatus | 'open'; mine?: boolean } = {}) {
    let params = new HttpParams();
    if (query.status) params = params.set('status', query.status);
    if (query.mine) params = params.set('mine', 'true');
    return this.data<ContributionView[]>(this.http.get(`${base(familyId)}/contributions`, { params }));
  }
  contribution(familyId: string, contributionId: string) {
    return this.data<ContributionView>(this.http.get(`${base(familyId)}/contributions/${id(contributionId)}`));
  }
  propose(familyId: string, body: SubmitContributionRequest) {
    return this.data<ContributionView>(this.http.post(`${base(familyId)}/contributions`, body));
  }
  claim(familyId: string, memberId: string, evidence: string) {
    return this.data<ContributionView>(this.http.post(`${base(familyId)}/claims`, { memberId, evidence: evidence || undefined }));
  }
  approve(familyId: string, contributionId: string, body: ReviewContributionRequest) {
    return this.data<ContributionView>(this.http.post(`${base(familyId)}/contributions/${id(contributionId)}/approve`, body));
  }
  reject(familyId: string, contributionId: string, note: string) {
    return this.data<ContributionView>(this.http.post(`${base(familyId)}/contributions/${id(contributionId)}/reject`, { note }));
  }
  askQuestion(familyId: string, contributionId: string, message: string) {
    return this.data<ContributionView>(this.http.post(`${base(familyId)}/contributions/${id(contributionId)}/request-clarification`, { message }));
  }
  respond(familyId: string, contributionId: string, message: string) {
    return this.data<ContributionView>(this.http.post(`${base(familyId)}/contributions/${id(contributionId)}/respond`, { message }));
  }
  withdraw(familyId: string, contributionId: string) {
    return this.data<ContributionView>(this.http.post(`${base(familyId)}/contributions/${id(contributionId)}/withdraw`, {}));
  }

  // memberships
  memberships(familyId: string) {
    return this.data<MembershipView[]>(this.http.get(`${base(familyId)}/memberships`));
  }
  updateMembership(familyId: string, membershipId: string, body: UpdateMembershipRequest) {
    return this.data<MembershipView[]>(this.http.patch(`${base(familyId)}/memberships/${id(membershipId)}`, body));
  }
  async removeMembership(familyId: string, membershipId: string) {
    await firstValueFrom(this.http.delete(`${base(familyId)}/memberships/${id(membershipId)}`));
  }
  async unlinkProfile(familyId: string, membershipId: string) {
    await firstValueFrom(this.http.delete(`${base(familyId)}/memberships/${id(membershipId)}/profile`));
  }
  async leave(familyId: string) {
    await firstValueFrom(this.http.post(`${base(familyId)}/leave`, {}));
  }

  // history
  audit(familyId: string, query: { page: number; pageSize: number; targetType?: string; targetId?: string; action?: string }) {
    let params = new HttpParams().set('page', query.page).set('pageSize', query.pageSize);
    for (const k of ['targetType', 'targetId', 'action'] as const) if (query[k]) params = params.set(k, query[k]!);
    return firstValueFrom(this.http.get<ApiPage<AuditEntryView>>(`${base(familyId)}/audit`, { params }));
  }
  restore(familyId: string, auditId: string) {
    return this.data<RestoreResult>(this.http.post(`${base(familyId)}/audit/${id(auditId)}/restore`, {}));
  }
  removedMembers(familyId: string) {
    return this.data<(PersonCard & { deletedAt: string })[]>(this.http.get(`${base(familyId)}/trash/members`));
  }
  restoreMember(familyId: string, memberId: string) {
    return this.data<RestoreResult>(this.http.post(`${base(familyId)}/trash/members/${id(memberId)}/restore`, {}));
  }
}
