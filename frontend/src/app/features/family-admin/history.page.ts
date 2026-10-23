import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { AuditEntryView, MediaView, PageMeta, PersonCard } from '@fh/contracts';
import { ArchiveApi } from '../../core/archive/archive.api';
import { ApiError } from '../../core/api/api-error';
import { CollaborationApi } from '../../core/collaboration/collaboration.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { fieldLabel, formatValue } from '../../shared/format-value';
import { AlertComponent } from '../../shared/ui/alert.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { mark, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

export const ACTION_LABELS: Record<string, string> = {
  'family.create': mark('Registered the family'),
  'family.update': mark('Changed family settings'),
  'family.set_founder': mark('Changed the founding ancestor'),
  'member.create': mark('Added a person'),
  'member.update': mark('Edited a person'),
  'member.delete': mark('Removed a person'),
  'member.restore': mark('Restored a person'),
  'relationship.create': mark('Added a link'),
  'relationship.update': mark('Edited a link'),
  'relationship.delete': mark('Removed a link'),
  'relationship.restore': mark('Restored a link'),
  'generation.override': mark('Resolved a generation conflict'),
  'generation.override.clear': mark('Undid a generation resolution'),
  'branch.create': mark('Created a branch'),
  'branch.update': mark('Edited a branch'),
  'branch.delete': mark('Deleted a branch'),
  'invitation.create': mark('Sent an invitation'),
  'invitation.revoke': mark('Revoked an invitation'),
  'invitation.accept': mark('Joined by invitation'),
  'membership.update': mark('Changed a role'),
  'membership.remove': mark('Removed a member'),
  'membership.leave': mark('Left the family'),
  'membership.link_profile': mark('Linked an account to a profile'),
  'membership.unlink_profile': mark('Unlinked an account from a profile'),
  'contribution.submit': mark('Made a suggestion'),
  'contribution.approve': mark('Approved a suggestion'),
  'contribution.reject': mark('Declined a suggestion'),
  'media.upload': mark('Added a file'),
  'media.update': mark('Edited a file'),
  'media.delete': mark('Removed a file'),
  'media.restore': mark('Restored a file'),
  'media.publish': mark('Published a file'),
  'media.reject': mark('Declined a file'),
  'story.create': mark('Wrote a story'),
  'story.update': mark('Edited a story'),
  'story.delete': mark('Removed a story'),
  'story.publish': mark('Published a story'),
  'story.reject': mark('Declined a story'),
  'event.create': mark('Recorded an event'),
  'event.update': mark('Edited an event'),
  'event.delete': mark('Removed an event'),
  'family.export': mark('Downloaded a copy of the family'),
  'family.delete_scheduled': mark('Scheduled the family for deletion'),
  'family.delete_cancelled': mark('Restored the family'),
  'import.commit': mark('Imported a GEDCOM file'),
  'import.undo': mark('Undid a GEDCOM import'),
  'member.merge': mark('Merged two records of a person'),
  'member.merge.undo': mark('Separated two merged records'),
  'duplicate.dismiss': mark('Marked two people as different'),
  'fund.create': mark('Created a fund'),
  'fund.update': mark('Changed a fund'),
  'fund.delete': mark('Removed a fund'),
  'fund.contribution.add': mark('Recorded a contribution'),
  'fund.contribution.update': mark('Corrected a contribution'),
  'fund.contribution.delete': mark('Removed a contribution'),
  'fund.export': mark("Downloaded a fund's records"),
  'media.tags': mark('Tagged people in a photo'),
  'media.transcript': mark('Edited a transcript'),
  'media.transcribe_request': mark('Asked for a transcript'),
  'media.transcribe': mark('Transcribed a recording'),
  'place.create': mark('Added a place'),
  'place.update': mark('Changed a place'),
  'place.delete': mark('Removed a place'),
  'book.create': mark('Made a family book'),
};

@Component({
  selector: 'fh-history-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, AlertComponent, SpinnerComponent, NoFamilyComponent, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else if (!context.can('audit.view')) {
      <fh-alert tone="info">{{ 'Only family administrators can see the change history.' | t }}</fh-alert>
    } @else {
      <header class="mb-6">
        <h1 class="text-3xl font-semibold">{{ 'Change history' | t }}</h1>
        <p class="mt-1 max-w-2xl text-sm text-stone-500">{{ "Every change to the family's records, who made it, and when. Edits and removals can be undone; undoing is itself recorded." | t }}</p>
        @if (targetId()) {
          <p class="mt-3 text-sm">{{ 'Showing changes to one person only.' | t }} <a routerLink="/family/history" class="font-medium text-brand-700 hover:underline dark:text-brand-300">{{ 'Show everything' | t }}</a></p>
        }
      </header>
      @if (message(); as m) { <fh-alert [tone]="m.tone" class="mb-4">{{ m.text }}</fh-alert> }

      @if (removed().length && !targetId()) {
        <section class="card mb-6 p-5" aria-labelledby="removed-h">
          <h2 id="removed-h" class="text-lg font-semibold">{{ 'Removed people' | t }}</h2>
          <ul class="mt-3 divide-y divide-stone-200 dark:divide-stone-800">
            @for (p of removed(); track p.id) {
              <li class="flex items-center gap-3 py-2">
                <span class="flex-1"><span class="font-medium">{{ p.displayName }}</span> <span class="text-xs text-stone-500">{{ 'removed {date}' | t: { date: (p.deletedAt | date: 'medium') } }}</span></span>
                <button type="button" class="btn-secondary !py-1.5 text-xs" (click)="restorePerson(p)">{{ 'Restore with their links' | t }}</button>
              </li>
            }
          </ul>
        </section>
      }

      @if (removedFiles().length && !targetId()) {
        <section class="card mb-6 p-5" aria-labelledby="removed-files-h">
          <h2 id="removed-files-h" class="text-lg font-semibold">{{ 'Removed photos & documents' | t }}</h2>
          <p class="mt-1 text-sm text-stone-500">{{ 'Kept for 30 days after removal, then erased for good.' | t }}</p>
          <ul class="mt-3 divide-y divide-stone-200 dark:divide-stone-800">
            @for (f of removedFiles(); track f.id) {
              <li class="flex items-center gap-3 py-2">
                <span class="flex-1"><span class="font-medium">{{ f.title }}</span> <span class="text-xs text-stone-500">{{ 'removed {date}' | t: { date: (f.deletedAt | date: 'medium') } }}</span></span>
                <button type="button" class="btn-secondary !py-1.5 text-xs" (click)="restoreFile(f)">{{ 'Restore' | t }}</button>
              </li>
            }
          </ul>
        </section>
      }

      <section class="card overflow-hidden" [attr.aria-label]="'Changes' | t">
        @if (entries() === null) {
          <div class="p-5"><fh-spinner /></div>
        } @else {
          <ol class="divide-y divide-stone-200 dark:divide-stone-800">
            @for (e of entries(); track e.id) {
              <li class="px-5 py-3">
                <div class="flex flex-wrap items-baseline gap-x-2">
                  <span class="font-medium">{{ actionLabel(e.action) }}</span>
                  @if (e.targetName) {
                    @if (e.targetType === 'member' && e.targetId) {
                      <a [routerLink]="['/members', e.targetId]" class="text-brand-700 hover:underline dark:text-brand-300">{{ e.targetName }}</a>
                    } @else { <span>{{ e.targetName }}</span> }
                  }
                  <span class="text-xs text-stone-500">{{ 'by {name}' | t: { name: e.actor?.displayName ?? ('the system' | t) } }} · {{ e.at | date: 'medium' }}</span>
                  @if (e.contributionId) { <a routerLink="/contributions" [queryParams]="{ id: e.contributionId }" class="badge bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">{{ 'from a suggestion' | t }}</a> }
                  @if (e.restorable) { <button type="button" class="btn-ghost ml-auto !py-1 text-xs" (click)="restore(e)">{{ 'Undo' | t }}</button> }
                </div>
                @if (e.changes.length) {
                  <ul class="mt-1 space-y-0.5 text-sm text-stone-600 dark:text-stone-300">
                    @for (c of e.changes; track c.field) {
                      <li><span class="mr-1 font-medium">{{ label(c.field) }}:</span><span class="line-through decoration-stone-300">{{ value(c.before) }}</span> → {{ value(c.after) }}</li>
                    }
                  </ul>
                }
              </li>
            } @empty {
              <li class="p-5 text-sm text-stone-500">{{ 'No changes yet.' | t }}</li>
            }
          </ol>
          @if (meta(); as m) {
            @if (m.totalPages > 1) {
              <nav class="flex items-center justify-between border-t border-stone-200 p-4 text-sm dark:border-stone-800" [attr.aria-label]="'Pagination' | t">
                <span class="text-stone-500">{{ 'Page {page} of {total}' | t: { page: m.page, total: m.totalPages } }}</span>
                <div class="flex gap-2">
                  <button type="button" class="btn-secondary !py-1.5" [disabled]="m.page <= 1" (click)="go(m.page - 1)">{{ 'Newer' | t }}</button>
                  <button type="button" class="btn-secondary !py-1.5" [disabled]="m.page >= m.totalPages" (click)="go(m.page + 1)">{{ 'Older' | t }}</button>
                </div>
              </nav>
            }
          }
        }
      </section>
    }
  `,
})
export class HistoryPage {
  /** Query parameter: limit the list to one person's changes. */
  readonly targetId = input<string>();
  protected readonly context = inject(FamilyContextStore);
  private readonly api = inject(CollaborationApi);
  private readonly archive = inject(ArchiveApi);
  protected readonly removedFiles = signal<(MediaView & { deletedAt: string })[]>([]);
  protected readonly entries = signal<AuditEntryView[] | null>(null);
  protected readonly meta = signal<PageMeta | null>(null);
  protected readonly removed = signal<(PersonCard & { deletedAt: string })[]>([]);
  protected readonly message = signal<{ tone: 'success' | 'error'; text: string } | null>(null);
  protected readonly label = fieldLabel;
  protected readonly value = formatValue;

  constructor() {
    effect(() => {
      const f = this.context.active();
      this.targetId();
      if (f && this.context.can('audit.view')) untracked(() => void this.go(1));
    });
  }

  protected async go(page: number): Promise<void> {
    const familyId = this.context.active()!.id;
    try {
      const [res, removed] = await Promise.all([this.api.audit(familyId, { page, pageSize: 40, targetId: this.targetId() }), this.api.removedMembers(familyId)]);
      this.entries.set(res.data);
      this.meta.set(res.meta);
      this.removed.set(removed);
      this.removedFiles.set(await this.archive.removedMedia(familyId).catch(() => []));
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
    }
  }

  protected actionLabel(a: string): string {
    const known = ACTION_LABELS[a];
    return known ? t(known) : a;
  }

  protected async restore(e: AuditEntryView): Promise<void> {
    try {
      await this.api.restore(this.context.active()!.id, e.id);
      this.message.set({ tone: 'success', text: t('Restored. The change is recorded in the history.') });
      await this.go(1);
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
    }
  }

  protected async restoreFile(f: MediaView): Promise<void> {
    try {
      await this.archive.restoreMedia(this.context.active()!.id, f.id);
      this.message.set({ tone: 'success', text: t('“{title}” is back in Photos & documents.', { title: f.title }) });
      await this.go(1);
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
    }
  }

  protected async restorePerson(p: PersonCard): Promise<void> {
    try {
      const r = await this.api.restoreMember(this.context.active()!.id, p.id);
      const params = { name: p.displayName, restored: r.relationshipsRestored, skipped: r.relationshipsSkipped };
      const text = r.relationshipsSkipped
        ? t('{name} is back, with {restored} link(s) restored; {skipped} could not be restored because they would conflict with newer records.', params)
        : t('{name} is back, with {restored} link(s) restored.', params);
      this.message.set({ tone: 'success', text });
      await this.go(1);
      void this.context.refresh();
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
    }
  }
}
