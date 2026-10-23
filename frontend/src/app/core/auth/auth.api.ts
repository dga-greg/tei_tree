import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  ApiSuccess,
  AuthResponse,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  MfaConfirmRequest,
  MfaStatus,
  MfaVerifyRequest,
  RecoveryCodesResponse,
  RegisterRequest,
  TotpSetupResponse,
  ResetPasswordRequest,
  SessionView,
  UpdateProfileRequest,
} from '@fh/contracts';
import { api } from '../api/api';

@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);

  /** Tells the server the person is using the app, so the idle sign-out does not apply. */
  async reportActivity() {
    await firstValueFrom(this.http.post<void>(api('/auth/activity'), {}));
  }

  async me() {
    return (await firstValueFrom(this.http.get<ApiSuccess<AuthResponse>>(api('/auth/me')))).data.user;
  }

  /** Either signed in, or a challenge for the two-step code. */
  async login(body: LoginRequest) {
    return (await firstValueFrom(this.http.post<ApiSuccess<LoginResponse>>(api('/auth/login'), body))).data;
  }

  async verifyMfa(body: MfaVerifyRequest) {
    return (await firstValueFrom(this.http.post<ApiSuccess<AuthResponse>>(api('/auth/login/mfa'), body))).data.user;
  }

  async mfaStatus() {
    return (await firstValueFrom(this.http.get<ApiSuccess<MfaStatus>>(api('/auth/mfa')))).data;
  }

  async mfaSetup(body: MfaConfirmRequest) {
    return (await firstValueFrom(this.http.post<ApiSuccess<TotpSetupResponse>>(api('/auth/mfa/totp/setup'), body))).data;
  }

  async mfaEnable(code: string) {
    return (await firstValueFrom(this.http.post<ApiSuccess<RecoveryCodesResponse>>(api('/auth/mfa/totp/enable'), { code }))).data.codes;
  }

  async mfaDisable(body: MfaConfirmRequest) {
    await firstValueFrom(this.http.post<void>(api('/auth/mfa/disable'), body));
  }

  async newRecoveryCodes(body: MfaConfirmRequest) {
    return (await firstValueFrom(this.http.post<ApiSuccess<RecoveryCodesResponse>>(api('/auth/mfa/recovery-codes'), body))).data.codes;
  }

  async unlinkGoogle() {
    await firstValueFrom(this.http.delete<void>(api('/auth/google')));
  }

  async register(body: RegisterRequest) {
    return (await firstValueFrom(this.http.post<ApiSuccess<AuthResponse>>(api('/auth/register'), body))).data.user;
  }

  refresh() {
    return this.http.post<ApiSuccess<AuthResponse>>(api('/auth/refresh'), {});
  }

  async logout() {
    await firstValueFrom(this.http.post<void>(api('/auth/logout'), {}));
  }

  async forgotPassword(email: string) {
    await firstValueFrom(this.http.post(api('/auth/forgot-password'), { email }));
  }

  async resetPassword(body: ResetPasswordRequest) {
    await firstValueFrom(this.http.post<void>(api('/auth/reset-password'), body));
  }

  async updateProfile(body: UpdateProfileRequest) {
    return (await firstValueFrom(this.http.patch<ApiSuccess<AuthResponse>>(api('/auth/me'), body))).data.user;
  }

  async changePassword(body: ChangePasswordRequest) {
    await firstValueFrom(this.http.post<void>(api('/auth/change-password'), body));
  }

  async sessions() {
    return (await firstValueFrom(this.http.get<ApiSuccess<SessionView[]>>(api('/auth/sessions')))).data;
  }

  async revokeSession(id: string) {
    await firstValueFrom(this.http.delete<void>(api(`/auth/sessions/${encodeURIComponent(id)}`)));
  }

  async verifyEmail(token: string) {
    return (await firstValueFrom(this.http.post<ApiSuccess<AuthResponse>>(api('/auth/verify-email'), { token }))).data.user;
  }

  async resendVerification() {
    await firstValueFrom(this.http.post(api('/auth/resend-verification'), {}));
  }
}
