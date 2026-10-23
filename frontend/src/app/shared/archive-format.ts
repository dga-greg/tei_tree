import { LucideFileAudio, LucideFileText, LucideFileVideo, LucideImage, type LucideIcon } from '@lucide/angular';
import type { MediaKind } from '@fh/contracts';

export const MEDIA_ICONS: Record<MediaKind, LucideIcon> = { photo: LucideImage, document: LucideFileText, audio: LucideFileAudio, video: LucideFileVideo };

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Accept attribute for file inputs: what the server takes (it still checks the content itself). */
export const UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/tiff,application/pdf,audio/*,video/mp4,video/webm,video/quicktime';

/** Paragraphs of a plain-text story. */
export function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}
