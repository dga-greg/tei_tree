import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiSuccess, BookOptions, BookView } from '@fh/contracts';
import { api } from '../api/api';

const base = (familyId: string) => api(`/families/${encodeURIComponent(familyId)}/books`);

/** Printable family books (each person's own). */
@Injectable({ providedIn: 'root' })
export class BookApi {
  private readonly http = inject(HttpClient);

  async list(familyId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<BookView[]>>(base(familyId)))).data;
  }
  async create(familyId: string, body: BookOptions) {
    return (await firstValueFrom(this.http.post<ApiSuccess<BookView>>(base(familyId), body))).data;
  }
  async remove(familyId: string, bookId: string) {
    await firstValueFrom(this.http.delete(`${base(familyId)}/${encodeURIComponent(bookId)}`));
  }
}
