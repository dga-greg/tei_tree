import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiSuccess, CalendarItem, DigestPreview, NotificationPreferences, PushStatus, PushSubscriptionInput } from '@fh/contracts';
import { api } from '../api/api';

/** The family calendar, and the signed-in person's reminders. */
@Injectable({ providedIn: 'root' })
export class CalendarApi {
  private readonly http = inject(HttpClient);

  async calendar(familyId: string, from: string, to: string) {
    const params = new HttpParams().set('from', from).set('to', to);
    return (await firstValueFrom(this.http.get<ApiSuccess<CalendarItem[]>>(api(`/families/${encodeURIComponent(familyId)}/calendar`), { params }))).data;
  }

  async preferences() {
    return (await firstValueFrom(this.http.get<ApiSuccess<NotificationPreferences>>(api('/notifications/preferences')))).data;
  }
  async setPreferences(prefs: NotificationPreferences) {
    return (await firstValueFrom(this.http.put<ApiSuccess<NotificationPreferences>>(api('/notifications/preferences'), prefs))).data;
  }
  async digestPreview() {
    return (await firstValueFrom(this.http.get<ApiSuccess<DigestPreview>>(api('/notifications/digest/preview')))).data;
  }

  async pushStatus() {
    return (await firstValueFrom(this.http.get<ApiSuccess<PushStatus>>(api('/notifications/push')))).data;
  }
  async subscribe(subscription: PushSubscriptionInput) {
    return (await firstValueFrom(this.http.post<ApiSuccess<PushStatus>>(api('/notifications/push/subscriptions'), subscription))).data;
  }
  async unsubscribe(endpoint: string) {
    return (await firstValueFrom(this.http.post<ApiSuccess<PushStatus>>(api('/notifications/push/unsubscribe'), { endpoint }))).data;
  }
  async testPush() {
    return (await firstValueFrom(this.http.post<ApiSuccess<{ sent: number }>>(api('/notifications/push/test'), {}))).data;
  }
}
