import { HttpClient, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { filter, firstValueFrom, map, tap } from 'rxjs';
import type { ApiSuccess, DuplicatePair, GedcomImportDecisions, GedcomImportPreview, ImportBatchView, MergeRequest, MergeView } from '@fh/contracts';
import { api } from '../api/api';

const base = (familyId: string) => api(`/families/${encodeURIComponent(familyId)}`);
const id = encodeURIComponent;

/** GEDCOM import, the duplicate finder and merges (family administrators). */
@Injectable({ providedIn: 'root' })
export class DataToolsApi {
  private readonly http = inject(HttpClient);

  private send<T>(url: string, file: File, fields: Record<string, unknown>, progress?: (fraction: number) => void): Promise<T> {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, JSON.stringify(v));
    form.append('file', file, file.name);
    return firstValueFrom(
      this.http.post<ApiSuccess<T>>(url, form, { reportProgress: true, observe: 'events' }).pipe(
        tap((e) => {
          if (e.type === HttpEventType.UploadProgress && e.total) progress?.(e.loaded / e.total);
        }),
        filter((e) => e.type === HttpEventType.Response),
        map((e) => (e as { body: ApiSuccess<T> }).body.data),
      ),
    );
  }

  previewGedcom(familyId: string, file: File, progress?: (fraction: number) => void) {
    return this.send<GedcomImportPreview>(`${base(familyId)}/import/gedcom/preview`, file, {}, progress);
  }
  importGedcom(familyId: string, file: File, decisions: GedcomImportDecisions, progress?: (fraction: number) => void) {
    return this.send<ImportBatchView>(`${base(familyId)}/import/gedcom`, file, { decisions }, progress);
  }
  async imports(familyId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<ImportBatchView[]>>(`${base(familyId)}/imports`))).data;
  }
  async undoImport(familyId: string, importId: string) {
    return (await firstValueFrom(this.http.post<ApiSuccess<ImportBatchView>>(`${base(familyId)}/imports/${id(importId)}/undo`, {}))).data;
  }

  async duplicates(familyId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<DuplicatePair[]>>(`${base(familyId)}/duplicates`))).data;
  }
  async dismiss(familyId: string, a: string, b: string) {
    await firstValueFrom(this.http.post(`${base(familyId)}/duplicates/dismiss`, { a, b }));
  }
  async merge(familyId: string, keepId: string, body: MergeRequest) {
    return (await firstValueFrom(this.http.post<ApiSuccess<MergeView>>(`${base(familyId)}/members/${id(keepId)}/merge`, body))).data;
  }
  async merges(familyId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<MergeView[]>>(`${base(familyId)}/merges`))).data;
  }
  async undoMerge(familyId: string, mergeId: string) {
    return (await firstValueFrom(this.http.post<ApiSuccess<MergeView>>(`${base(familyId)}/merges/${id(mergeId)}/undo`, {}))).data;
  }
}
