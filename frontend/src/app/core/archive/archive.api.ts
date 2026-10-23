import { HttpClient, HttpEventType, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { filter, firstValueFrom, map, tap } from 'rxjs';
import type {
  ApiPage,
  ApiSuccess,
  EventInput,
  EventView,
  MediaListQuery,
  MediaView,
  PhotoTagInput,
  StoryInput,
  StoryKind,
  StoryView,
  TimelineItem,
  TranscriptInput,
  UpdateEventRequest,
  UpdateMediaRequest,
  UpdateStoryRequest,
  UploadMediaFields,
} from '@fh/contracts';
import { api } from '../api/api';

const base = (familyId: string) => api(`/families/${encodeURIComponent(familyId)}`);
const id = encodeURIComponent;

function params(query: object): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p = p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  return p;
}

@Injectable({ providedIn: 'root' })
export class ArchiveApi {
  private readonly http = inject(HttpClient);

  // ---- media
  media(familyId: string, query: MediaListQuery = {}) {
    return firstValueFrom(this.http.get<ApiPage<MediaView>>(`${base(familyId)}/media`, { params: params(query) }));
  }
  async mediaItem(familyId: string, mediaId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<MediaView>>(`${base(familyId)}/media/${id(mediaId)}`))).data;
  }
  /** Uploads one file; `progress` receives 0–1. Metadata fields are sent before the file part. */
  upload(familyId: string, file: File, fields: UploadMediaFields & { note?: string }, progress?: (fraction: number) => void): Promise<MediaView> {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
      form.append(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
    form.append('file', file, file.name);
    return firstValueFrom(
      this.http.post<ApiSuccess<MediaView>>(`${base(familyId)}/media`, form, { reportProgress: true, observe: 'events' }).pipe(
        tap((e) => {
          if (e.type === HttpEventType.UploadProgress && e.total) progress?.(e.loaded / e.total);
        }),
        filter((e) => e.type === HttpEventType.Response),
        map((e) => (e as { body: ApiSuccess<MediaView> }).body.data),
      ),
    );
  }
  async updateMedia(familyId: string, mediaId: string, body: UpdateMediaRequest) {
    return (await firstValueFrom(this.http.patch<ApiSuccess<MediaView>>(`${base(familyId)}/media/${id(mediaId)}`, body))).data;
  }
  async setTags(familyId: string, mediaId: string, version: number, tags: PhotoTagInput[]) {
    return (await firstValueFrom(this.http.put<ApiSuccess<MediaView>>(`${base(familyId)}/media/${id(mediaId)}/tags`, { version, tags }))).data;
  }
  async setTranscript(familyId: string, mediaId: string, body: TranscriptInput) {
    return (await firstValueFrom(this.http.put<ApiSuccess<MediaView>>(`${base(familyId)}/media/${id(mediaId)}/transcript`, body))).data;
  }
  async transcribe(familyId: string, mediaId: string, translate: boolean) {
    return (await firstValueFrom(this.http.post<ApiSuccess<MediaView>>(`${base(familyId)}/media/${id(mediaId)}/transcribe`, { translate }))).data;
  }
  async removeMedia(familyId: string, mediaId: string) {
    await firstValueFrom(this.http.delete(`${base(familyId)}/media/${id(mediaId)}`));
  }

  async removedMedia(familyId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<(MediaView & { deletedAt: string })[]>>(`${base(familyId)}/trash/media`))).data;
  }
  async restoreMedia(familyId: string, mediaId: string) {
    return (await firstValueFrom(this.http.post<ApiSuccess<MediaView>>(`${base(familyId)}/trash/media/${id(mediaId)}/restore`, {}))).data;
  }

  // ---- stories
  stories(familyId: string, query: { kind?: StoryKind; memberId?: string; eventId?: string; q?: string; page?: number; pageSize?: number } = {}) {
    return firstValueFrom(this.http.get<ApiPage<StoryView>>(`${base(familyId)}/stories`, { params: params(query) }));
  }
  async story(familyId: string, storyId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<StoryView>>(`${base(familyId)}/stories/${id(storyId)}`))).data;
  }
  async createStory(familyId: string, body: StoryInput & { note?: string }) {
    return (await firstValueFrom(this.http.post<ApiSuccess<StoryView>>(`${base(familyId)}/stories`, body))).data;
  }
  async updateStory(familyId: string, storyId: string, body: UpdateStoryRequest) {
    return (await firstValueFrom(this.http.patch<ApiSuccess<StoryView>>(`${base(familyId)}/stories/${id(storyId)}`, body))).data;
  }
  async removeStory(familyId: string, storyId: string) {
    await firstValueFrom(this.http.delete(`${base(familyId)}/stories/${id(storyId)}`));
  }

  // ---- events & timeline
  async events(familyId: string, query: { memberId?: string; ceremonies?: boolean } = {}) {
    return (await firstValueFrom(this.http.get<ApiSuccess<EventView[]>>(`${base(familyId)}/events`, { params: params(query) }))).data;
  }
  async event(familyId: string, eventId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<EventView>>(`${base(familyId)}/events/${id(eventId)}`))).data;
  }
  async createEvent(familyId: string, body: EventInput) {
    return (await firstValueFrom(this.http.post<ApiSuccess<EventView>>(`${base(familyId)}/events`, body))).data;
  }
  async updateEvent(familyId: string, eventId: string, body: UpdateEventRequest) {
    return (await firstValueFrom(this.http.patch<ApiSuccess<EventView>>(`${base(familyId)}/events/${id(eventId)}`, body))).data;
  }
  async removeEvent(familyId: string, eventId: string) {
    await firstValueFrom(this.http.delete(`${base(familyId)}/events/${id(eventId)}`));
  }
  timeline(familyId: string, query: { memberId?: string; from?: number; to?: number; include?: string[] } = {}) {
    return firstValueFrom(this.http.get<{ data: TimelineItem[]; meta: { truncated: boolean } }>(`${base(familyId)}/timeline`, { params: params(query) }));
  }
}
