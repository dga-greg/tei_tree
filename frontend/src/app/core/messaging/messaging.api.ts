import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  AnnouncementPreview,
  AnnouncementRecipientView,
  AnnouncementRequest,
  AnnouncementView,
  ApiSuccess,
  MessagingStatus,
  RsvpAnswer,
  RsvpView,
} from '@fh/contracts';
import { api } from '../api/api';

const base = (familyId: string) => api(`/families/${encodeURIComponent(familyId)}`);
const id = encodeURIComponent;

/** The words around the message, in the sender's language. */
export interface AnnouncementWords {
  linkLabel?: string;
  reminderMessage?: string;
}

/** Ceremony announcements by SMS, WhatsApp, e-mail and app notification, and the personal links people answer. */
@Injectable({ providedIn: 'root' })
export class MessagingApi {
  private readonly http = inject(HttpClient);

  async status(familyId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<MessagingStatus>>(`${base(familyId)}/messaging`))).data;
  }
  async list(familyId: string, eventId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<AnnouncementView[]>>(`${base(familyId)}/events/${id(eventId)}/announcements`))).data;
  }
  async preview(familyId: string, eventId: string, body: AnnouncementRequest & AnnouncementWords) {
    return (await firstValueFrom(this.http.post<ApiSuccess<AnnouncementPreview>>(`${base(familyId)}/events/${id(eventId)}/announcements/preview`, body))).data;
  }
  async send(familyId: string, eventId: string, body: AnnouncementRequest & AnnouncementWords) {
    return (await firstValueFrom(this.http.post<ApiSuccess<AnnouncementView>>(`${base(familyId)}/events/${id(eventId)}/announcements`, body))).data;
  }
  async recipients(familyId: string, announcementId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<AnnouncementRecipientView[]>>(`${base(familyId)}/announcements/${id(announcementId)}/recipients`))).data;
  }

  /** Public: the page behind a personal link. */
  async rsvp(token: string) {
    return (await firstValueFrom(this.http.post<ApiSuccess<RsvpView>>(api('/rsvp/view'), { token }))).data;
  }
  async answer(token: string, answer: RsvpAnswer) {
    return (await firstValueFrom(this.http.post<ApiSuccess<RsvpView>>(api('/rsvp/answer'), { token, answer }))).data;
  }
}
