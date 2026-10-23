import type { Dialog } from '@angular/cdk/dialog';
import { firstValueFrom } from 'rxjs';
import type { MediaView } from '@fh/contracts';
import type { ArchiveApi } from '../../core/archive/archive.api';
import { t } from '../../core/i18n/i18n';
import { PhotoCropDialogComponent, type PhotoCropData } from './photo-crop-dialog.component';

/** Lets the person crop a chosen picture to the profile square. Resolves with the cropped file, or null when cancelled. */
export async function cropPhoto(dialog: Dialog, file: File): Promise<File | null> {
  const ref = dialog.open<File, PhotoCropData>(PhotoCropDialogComponent, { data: { file } });
  return (await firstValueFrom(ref.closed)) ?? null;
}

/**
 * Uploads the picture as the person's profile photo. It shows at
 * once, or after a moderator approves it when the viewer's uploads are reviewed (status `pending_approval`).
 */
export function uploadProfilePhoto(archive: ArchiveApi, familyId: string, person: { id: string; displayName: string }, file: File): Promise<MediaView> {
  return archive.upload(familyId, file, { title: t('Profile photo of {name}', { name: person.displayName }), profileOf: person.id });
}
