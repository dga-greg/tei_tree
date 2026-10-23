import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideDynamicIcon } from '@lucide/angular';
import { MEDIA_KIND_LABELS, type MediaView } from '@fh/contracts';
import { formatFuzzyDate } from '../format';
import { MEDIA_ICONS } from '../archive-format';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Thumbnails of archive files; photos show a preview, other files an icon card. */
@Component({
  selector: 'fh-media-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideDynamicIcon, TranslatePipe],
  template: `
    <ul class="grid gap-3" [class]="compact() ? 'grid-cols-3 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'" role="list">
      @for (m of items(); track m.id; let i = $index) {
        <li>
          <button type="button" class="group relative block aspect-square w-full overflow-hidden rounded-xl border border-stone-200 bg-stone-100 text-left focus-visible:outline-2 focus-visible:outline-offset-2 dark:border-stone-800 dark:bg-stone-800" (click)="open.emit(i)" [attr.aria-label]="label(m)">
            @if (m.urls.thumb) {
              <img [src]="m.urls.thumb" alt="" loading="lazy" class="size-full object-cover transition group-hover:scale-[1.03]" />
            } @else {
              <span class="flex size-full flex-col items-center justify-center gap-2 p-3 text-center">
                <svg [lucideIcon]="icons[m.kind]" class="size-8 text-stone-400" aria-hidden="true"></svg>
                <span class="line-clamp-3 text-xs font-medium text-stone-700 dark:text-stone-300">{{ m.title }}</span>
              </span>
            }
            @if (m.status !== 'published') {
              <span class="badge absolute left-2 top-2 bg-gold-100 text-gold-700">{{ m.status === 'pending_approval' ? ('In review' | t) : ('Not accepted' | t) }}</span>
            }
            @if (!compact() && m.urls.thumb) {
              <span class="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2.5 pb-2 pt-6 text-xs font-medium text-white">{{ m.title }}</span>
            }
          </button>
        </li>
      }
    </ul>
  `,
})
export class MediaGridComponent {
  readonly items = input.required<MediaView[]>();
  readonly compact = input(false);
  readonly open = output<number>();
  protected readonly icons = MEDIA_ICONS;

  protected label(m: MediaView): string {
    const kind = t(MEDIA_KIND_LABELS[m.kind]);
    return m.date ? t('{kind}: {title}, {date}', { kind, title: m.title, date: formatFuzzyDate(m.date) }) : t('{kind}: {title}', { kind, title: m.title });
  }
}
