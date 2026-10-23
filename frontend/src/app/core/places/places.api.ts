import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ApiSuccess, PlaceDetail, PlaceInput, PlacesOverview, PlaceView, UpdatePlaceRequest } from '@fh/contracts';
import { api } from '../api/api';

const base = (familyId: string) => api(`/families/${encodeURIComponent(familyId)}/places`);
const id = encodeURIComponent;

/** Places the family has lived. */
@Injectable({ providedIn: 'root' })
export class PlacesApi {
  private readonly http = inject(HttpClient);

  async overview(familyId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<PlacesOverview>>(base(familyId)))).data;
  }
  async detail(familyId: string, placeId: string) {
    return (await firstValueFrom(this.http.get<ApiSuccess<PlaceDetail>>(`${base(familyId)}/${id(placeId)}`))).data;
  }
  async create(familyId: string, body: PlaceInput) {
    return (await firstValueFrom(this.http.post<ApiSuccess<PlaceView>>(base(familyId), body))).data;
  }
  async update(familyId: string, placeId: string, body: UpdatePlaceRequest) {
    return (await firstValueFrom(this.http.patch<ApiSuccess<PlaceView>>(`${base(familyId)}/${id(placeId)}`, body))).data;
  }
  async remove(familyId: string, placeId: string) {
    await firstValueFrom(this.http.delete(`${base(familyId)}/${id(placeId)}`));
  }
}
