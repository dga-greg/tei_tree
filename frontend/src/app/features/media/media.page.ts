import { Dialog } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LucideImagePlus, LucideSearch } from '@lucide/angular';
import { canPropose, type MediaKind, type MediaView, type PageMeta, type PersonCard } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { ArchiveApi } from '../../core/archive/archive.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { MembersApi } from '../../core/members/members.api';
import { AlertComponent } from '../../shared/ui/alert.component';
import { MediaGridComponent } from '../../shared/ui/media-grid.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonPickerComponent } from '../../shared/ui/person-picker.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { MediaViewerComponent, type MediaViewerData } from './media-viewer.component';
import { UploadDialogComponent, type UploadDialogData } from './upload-dialog.component';
import { mark, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

const TABS: { id: MediaKind | 'all'; label: string }[] = [
  { id: 'all', label: mark('Everything') },
  { id: 'photo', label: mark('Photos') },
  { id: 'document', label: mark('Documents') },
  { id: 'audio', label: mark('Recordings') },
  { id: 'video', label: mark('Videos') },
];

/** Uploads permission for the active family: directly, after review, or not at all. */
export function uploadMode(context: FamilyContextStore): 'direct' | 'review' | null {
  const family = context.active();
  if (!family) return null;
  if (context.can('media.upload')) return 'direct';
  if (canPropose({ role: family.role }, 'media.upload') && context.details()?.privacy?.allowMemberUploads !== false) return 'review';
  return null;
}

@Component({
  selector: 'fh-media-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MediaGridComponent, PersonPickerComponent, AlertComponent, SpinnerComponent, NoFamilyComponent, LucideImagePlus, LucideSearch, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else {
      <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold">{{ 'Photos & documents' | t }}</h1>
          <p class="mt-1 max-w-2xl text-sm text-stone-500">{{ 'Photographs, certificates, letters, recordings and videos, with who is in them and where they came from.' | t }}</p>
        </div>
        @if (mode()) {
          <button type="button" class="btn-primary" (click)="upload()"><svg lucideImagePlus class="size-4"></svg> {{ 'Add files' | t }}</button>
        }
      </header>

      <div class="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end">
        <div role="tablist" [attr.aria-label]="'Kind of file' | t" class="flex flex-wrap gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-800">
          @for (t of tabs; track t.id) {
            <button type="button" role="tab" [attr.aria-selected]="kind() === t.id" class="rounded-lg px-3 py-1.5 text-sm font-medium"
                    [class]="kind() === t.id ? 'bg-white shadow-sm dark:bg-stone-950' : 'text-stone-600 hover:text-stone-900 dark:text-stone-300'" (click)="setKind(t.id)">{{ t.label | t }}</button>
          }
        </div>
        <div class="relative flex-1 xl:max-w-xs">
          <label class="label" for="media-q">{{ 'Search' | t }}</label>
          <svg lucideSearch class="pointer-events-none absolute bottom-3 left-3 size-4 text-stone-400" aria-hidden="true"></svg>
          <input id="media-q" class="input !pl-9" type="search" [placeholder]="'Title, description or what is said' | t" [value]="q()" (input)="onSearch($any($event.target).value)" />
        </div>
        <div class="xl:w-72">
          <fh-person-picker [familyId]="context.active()!.id" [label]="'Person' | t" [value]="person()" (picked)="setPerson($event)" />
        </div>
      </div>

      @if (error(); as e) { <fh-alert class="mb-4">{{ e }}</fh-alert> }
      @if (notice(); as n) { <fh-alert tone="success" class="mb-4">{{ n }}</fh-alert> }

      @if (items() === null) {
        <fh-spinner [showLabel]="true" />
      } @else if (items()!.length === 0) {
        <div class="card p-10 text-center">
          <p class="font-medium">{{ filtered() ? ('Nothing matches these filters.' | t) : ('The archive is empty so far.' | t) }}</p>
          @if (!filtered() && mode()) { <p class="mt-1 text-sm text-stone-500">{{ 'Add the first photographs or documents of the {name}.' | t: { name: context.active()!.name } }}</p> }
        </div>
      } @else {
        <fh-media-grid [items]="items()!" (open)="view($event)" />
        @if (meta(); as m) {
          <p class="mt-4 text-center text-sm text-stone-500">{{ 'Showing {shown} of {total}' | t: { shown: items()!.length, total: m.total } }}</p>
          @if (m.page < m.totalPages) { <!-- i18n-ignore -->
            <div class="mt-3 text-center"><button type="button" class="btn-secondary" (click)="more()" [disabled]="loading()">{{ 'Show more' | t }}</button></div>
          }
        }
      }
    }
  `,
})
export class MediaPage {
  /** Query parameter: show files about one person. */
  readonly member = input<string>();

  protected readonly context = inject(FamilyContextStore);
  private readonly archive = inject(ArchiveApi);
  private readonly membersApi = inject(MembersApi);
  private readonly dialog = inject(Dialog);

  protected readonly tabs = TABS;
  protected readonly kind = signal<MediaKind | 'all'>('all');
  protected readonly q = signal('');
  protected readonly person = signal<PersonCard | null>(null);
  protected readonly items = signal<MediaView[] | null>(null);
  protected readonly meta = signal<PageMeta | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);
  protected readonly mode = computed(() => uploadMode(this.context));
  protected readonly filtered = computed(() => this.kind() !== 'all' || !!this.q() || !!this.person());
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const family = this.context.active();
      const memberId = this.member();
      if (!family) return;
      untracked(async () => {
        if (memberId && this.person()?.id !== memberId) {
          this.person.set(await this.membersApi.get(family.id, memberId).catch(() => null));
        }
        await this.load(1);
      });
    });
  }

  protected setKind(kind: MediaKind | 'all'): void {
    this.kind.set(kind);
    void this.load(1);
  }

  protected setPerson(p: PersonCard | null): void {
    this.person.set(p);
    void this.load(1);
  }

  protected onSearch(value: string): void {
    this.q.set(value);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.load(1), 300);
  }

  protected more(): void {
    void this.load((this.meta()?.page ?? 1) + 1);
  }

  private async load(page: number): Promise<void> {
    const family = this.context.active();
    if (!family) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      const kind = this.kind();
      const res = await this.archive.media(family.id, {
        kind: kind === 'all' ? undefined : kind,
        q: this.q().trim() || undefined,
        memberId: this.person()?.id,
        page,
        pageSize: 40,
      });
      this.items.set(page === 1 ? res.data : [...(this.items() ?? []), ...res.data]);
      this.meta.set(res.meta);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
      if (page === 1) this.items.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected async upload(): Promise<void> {
    const family = this.context.active()!;
    const person = this.person();
    const ref = this.dialog.open<MediaView[], UploadDialogData>(UploadDialogComponent, {
      data: { familyId: family.id, people: person ? [person] : [], review: this.mode() === 'review' },
    });
    const added = (await firstValueFrom(ref.closed)) ?? [];
    if (added.length) {
      const pending = added.filter((m) => m.status === 'pending_approval').length;
      this.notice.set(
        pending
          ? t('{count, plural, one {# file(s) added. A moderator will review them before the family sees them.} other {# file(s) added. A moderator will review them before the family sees them.}}', { count: added.length })
          : t('{count, plural, one {# file(s) added to the archive.} other {# file(s) added to the archive.}}', { count: added.length }),
      );
      await this.load(1);
    }
  }

  protected async view(index: number): Promise<void> {
    const ref = this.dialog.open<boolean, MediaViewerData>(MediaViewerComponent, {
      data: { familyId: this.context.active()!.id, items: this.items()!, index },
      ariaLabel: t('File viewer'),
    });
    if (await firstValueFrom(ref.closed)) await this.load(1);
  }
}
