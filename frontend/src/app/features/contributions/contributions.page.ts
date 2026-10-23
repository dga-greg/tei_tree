import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideMessageCircle } from '@lucide/angular';
import { CONTRIBUTION_KIND_LABELS, type ContributionStatus, type ContributionView } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { CollaborationApi } from '../../core/collaboration/collaboration.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { fieldLabel, formatValue } from '../../shared/format-value';
import { AlertComponent } from '../../shared/ui/alert.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { mark, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

type Tab = 'open' | 'mine' | 'decided';

const STATUS_LABELS: Record<ContributionStatus, string> = {
  pending: mark('Waiting for review'),
  needs_clarification: mark('Question asked'),
  approved: mark('Approved'),
  rejected: mark('Not accepted'),
  withdrawn: mark('Withdrawn'),
};

@Component({
  selector: 'fh-contributions-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, DatePipe, AlertComponent, SpinnerComponent, NoFamilyComponent, PersonAvatarComponent, LucideMessageCircle, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else {
      <header class="mb-6">
        <h1 class="text-3xl font-semibold">{{ reviewer() ? ('Suggestions to review' | t) : ('My suggestions' | t) }}</h1>
        <p class="mt-1 max-w-2xl text-sm text-stone-500">
          {{ 'Family members suggest new relatives, corrections and links; administrators and moderators review them. Approved changes are applied with the same checks as direct edits and recorded in the family history.' | t }}
        </p>
      </header>

      <div class="mb-4 flex gap-1 border-b border-stone-200 dark:border-stone-800" role="tablist" [attr.aria-label]="'Filter suggestions' | t">
        @for (tb of tabs(); track tb.id) {
          <button type="button" role="tab" [attr.aria-selected]="tab() === tb.id" class="-mb-px border-b-2 px-4 py-2 text-sm font-medium"
                  (click)="setTab(tb.id)" [class]="tab() === tb.id ? 'border-brand-600 text-brand-800 dark:text-brand-200' : 'border-transparent text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'">{{ tb.label }}</button>
        }
      </div>

      @if (message(); as m) { <fh-alert [tone]="m.tone" class="mb-4">{{ m.text }}</fh-alert> }

      <div class="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section [attr.aria-label]="'Suggestions' | t">
          @if (items() === null) {
            <fh-spinner [showLabel]="true" />
          } @else {
            <ul class="space-y-2">
              @for (c of items(); track c.id) {
                <li>
                  <button type="button" class="card flex w-full items-start gap-3 p-4 text-left transition hover:shadow-(--shadow-raised)" [class.ring-2]="selected()?.id === c.id" [class.ring-brand-500]="selected()?.id === c.id" (click)="select(c)">
                    <div class="min-w-0 flex-1">
                      <p class="text-xs font-semibold uppercase tracking-wide text-stone-500">{{ kindLabel(c) }}</p>
                      <p class="mt-0.5 font-medium">{{ c.summary }}</p>
                      <p class="mt-1 text-xs text-stone-500">{{ 'by {name}' | t: { name: c.proposedBy.displayName } }} · {{ c.createdAt | date: 'medium' }}</p>
                    </div>
                    <span class="badge shrink-0" [class]="statusTone(c.status)">{{ statusLabel(c.status) }}</span>
                  </button>
                </li>
              } @empty {
                <li class="card p-8 text-center text-sm text-stone-500">{{ 'Nothing here.' | t }}</li>
              }
            </ul>
          }
        </section>

        @if (selected(); as c) {
          <section class="card h-fit p-6" aria-labelledby="detail-h">
            <p class="text-xs font-semibold uppercase tracking-wide text-stone-500">{{ kindLabel(c) }} · {{ statusLabel(c.status) }}</p>
            <h2 id="detail-h" class="mt-1 text-xl font-semibold">{{ c.summary }}</h2>

            @if (c.target || c.people.length) {
              <div class="mt-3 flex flex-wrap gap-2">
                @for (p of c.target ? [c.target] : c.people; track p.id) {
                  <a [routerLink]="['/members', p.id]" class="flex items-center gap-2 rounded-xl border border-stone-200 px-2.5 py-1.5 text-sm hover:bg-stone-50 dark:border-stone-700 dark:hover:bg-stone-800">
                    <fh-person-avatar [name]="p.displayName" size="sm" /> {{ p.displayName }}
                  </a>
                }
              </div>
            }

            @if (c.stale && c.viewerCan.review) {
              <fh-alert tone="info" class="mt-4">{{ 'The record has changed since this was suggested. Check the “now” column before approving.' | t }}</fh-alert>
            }

            @if (c.archiveItem; as a) {
              <div class="mt-5 flex gap-4 rounded-xl border border-stone-200 p-4 dark:border-stone-800">
                @if (a.thumbUrl) { <img [src]="a.thumbUrl" alt="" class="size-28 shrink-0 rounded-lg object-cover" /> }
                <div class="min-w-0 flex-1">
                  <p class="font-medium">{{ a.title }}</p>
                  @if (a.excerpt) { <p class="mt-1 line-clamp-4 text-sm text-stone-600 dark:text-stone-300">{{ a.excerpt }}</p> }
                  <a class="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
                     [routerLink]="a.type === 'story' ? ['/history/stories', a.id] : ['/media']">{{ a.type === 'story' ? ('Read the whole story' | t) : ('Open in Photos & documents' | t) }}</a>
                </div>
              </div>
            } @else if (c.stale && (c.kind === 'media.attach' || c.kind === 'story.create')) {
              <p class="mt-4 text-sm text-stone-500">{{ 'The item has been removed.' | t }}</p>
            }

            @if (c.changes.length) {
              <div class="mt-5 overflow-x-auto">
                <table class="w-full text-left text-sm">
                  <thead class="text-xs uppercase tracking-wide text-stone-500">
                    <tr><th scope="col" class="py-2 pr-4">{{ 'Field' | t }}</th>@if (c.kind !== 'member.create') { <th scope="col" class="py-2 pr-4">{{ 'Now' | t }}</th> }<th scope="col" class="py-2">{{ 'Suggested' | t }}</th></tr>
                  </thead>
                  <tbody class="divide-y divide-stone-100 dark:divide-stone-800">
                    @for (ch of c.changes; track ch.field) {
                      <tr>
                        <th scope="row" class="py-2 pr-4 font-medium">{{ label(ch.field) }}</th>
                        @if (c.kind !== 'member.create') { <td class="py-2 pr-4 text-stone-500 line-through decoration-stone-300">{{ value(ch.current) }}</td> }
                        <td class="py-2 font-medium text-brand-800 dark:text-brand-200">{{ value(ch.proposed) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else if (c.payload['reason']) {
              <p class="mt-4 text-sm"><span class="font-medium">{{ 'Reason:' | t }}</span> {{ c.payload['reason'] }}</p>
            }

            <section class="mt-6" aria-labelledby="disc-h">
              <h3 id="disc-h" class="flex items-center gap-2 font-sans text-xs font-semibold uppercase tracking-wide text-stone-500"><svg lucideMessageCircle class="size-4"></svg> {{ 'Discussion' | t }}</h3>
              <ol class="mt-2 space-y-2">
                @for (d of c.discussion; track $index) {
                  <li class="rounded-xl bg-stone-50 p-3 text-sm dark:bg-stone-800/60">
                    <p class="text-xs text-stone-500">{{ d.byName }} · {{ d.at | date: 'medium' }}</p>
                    <p class="mt-1 whitespace-pre-line">{{ d.message }}</p>
                  </li>
                } @empty {
                  <li class="text-sm text-stone-500">{{ 'No messages.' | t }}</li>
                }
              </ol>
              @if (c.reviewNote) { <p class="mt-3 text-sm"><span class="font-medium">{{ c.reviewedBy?.displayName }}:</span> {{ c.reviewNote }}</p> }
            </section>

            @if (c.viewerCan.review || c.viewerCan.respond) {
              <div class="mt-6">
                <label class="label" for="reply">{{ c.viewerCan.review ? ('Note or question for {name}' | t: { name: c.proposedBy.displayName }) : ('Your answer' | t) }}</label>
                <textarea id="reply" class="input min-h-20" [(ngModel)]="reply" name="reply"></textarea>
              </div>
            }
            <div class="mt-4 flex flex-wrap gap-2">
              @if (c.viewerCan.review) {
                <button type="button" class="btn-primary" [disabled]="busy()" (click)="approve(c)">{{ c.stale ? ('Approve anyway' | t) : ('Approve' | t) }}</button>
                <button type="button" class="btn-secondary" [disabled]="busy() || reply.trim().length < 2" (click)="ask(c)">{{ 'Ask a question' | t }}</button>
                <button type="button" class="btn-ghost text-red-700 dark:text-red-400" [disabled]="busy() || reply.trim().length < 3" (click)="reject(c)">{{ 'Do not accept' | t }}</button>
              }
              @if (c.viewerCan.respond) {
                <button type="button" class="btn-primary" [disabled]="busy() || reply.trim().length < 2" (click)="respond(c)">{{ 'Send answer' | t }}</button>
              }
              @if (c.viewerCan.withdraw) {
                <button type="button" class="btn-ghost" [disabled]="busy()" (click)="withdraw(c)">{{ 'Withdraw' | t }}</button>
              }
            </div>
            @if (c.viewerCan.review) { <p class="mt-2 text-xs text-stone-500">{{ 'A reason is required when not accepting, and is shared with the person who suggested it.' | t }}</p> }
          </section>
        }
      </div>
    }
  `,
})
export class ContributionsPage {
  /** Optional deep link to one suggestion. */
  readonly id = input<string>();

  protected readonly context = inject(FamilyContextStore);
  private readonly api = inject(CollaborationApi);
  private readonly router = inject(Router);

  protected readonly tab = signal<Tab>('open');
  protected readonly items = signal<ContributionView[] | null>(null);
  protected readonly selected = signal<ContributionView | null>(null);
  protected readonly busy = signal(false);
  protected readonly message = signal<{ tone: 'success' | 'error'; text: string } | null>(null);
  protected reply = '';

  protected readonly reviewer = computed(() => this.context.can('contribution.review') || this.context.active()?.role === 'family_moderator');
  protected readonly tabs = computed(() =>
    this.reviewer()
      ? [
          { id: 'open' as Tab, label: t('To review') },
          { id: 'mine' as Tab, label: t('My suggestions') },
          { id: 'decided' as Tab, label: t('Decided') },
        ]
      : [
          { id: 'open' as Tab, label: t('Open') },
          { id: 'decided' as Tab, label: t('Decided') },
        ],
  );

  constructor() {
    effect(() => {
      const f = this.context.active();
      if (f) untracked(() => void this.load());
    });
  }

  private async load(): Promise<void> {
    const familyId = this.context.active()!.id;
    const tab = this.tab();
    try {
      let list: ContributionView[];
      if (tab === 'decided') {
        const [approved, rejected] = await Promise.all([this.api.contributions(familyId, { status: 'approved' }), this.api.contributions(familyId, { status: 'rejected' })]);
        list = [...approved, ...rejected].sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? ''));
      } else {
        list = await this.api.contributions(familyId, { status: 'open', mine: tab === 'mine' });
      }
      this.items.set(list);
      const wanted = this.id() ?? this.selected()?.id;
      this.selected.set(list.find((c) => c.id === wanted) ?? list[0] ?? null);
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
      this.items.set([]);
    }
  }

  protected setTab(next: Tab): void {
    this.tab.set(next);
    this.items.set(null);
    this.selected.set(null);
    void this.load();
  }

  protected select(c: ContributionView): void {
    this.selected.set(c);
    this.reply = '';
    void this.router.navigate([], { queryParams: { id: c.id }, replaceUrl: true });
  }

  protected kindLabel(c: ContributionView): string {
    return t(CONTRIBUTION_KIND_LABELS[c.kind]);
  }
  protected statusLabel(s: ContributionStatus): string {
    return t(STATUS_LABELS[s]);
  }
  protected statusTone(s: ContributionStatus): string {
    return s === 'approved'
      ? 'bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200'
      : s === 'needs_clarification'
        ? 'bg-gold-100 text-gold-700'
        : s === 'pending'
          ? 'bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200'
          : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300';
  }
  protected label = fieldLabel;
  protected value = formatValue;

  private async act(task: () => Promise<ContributionView>, success: string): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      const updated = await task();
      this.message.set({ tone: 'success', text: success });
      this.reply = '';
      this.selected.set(updated);
      await this.load();
      void this.context.refresh();
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
    } finally {
      this.busy.set(false);
    }
  }

  protected approve(c: ContributionView) {
    return this.act(() => this.api.approve(this.context.active()!.id, c.id, { note: this.reply.trim() || undefined, force: c.stale }), t('Approved and applied.'));
  }
  protected reject(c: ContributionView) {
    return this.act(() => this.api.reject(this.context.active()!.id, c.id, this.reply.trim()), t('Marked as not accepted.'));
  }
  protected ask(c: ContributionView) {
    return this.act(() => this.api.askQuestion(this.context.active()!.id, c.id, this.reply.trim()), t('Question sent.'));
  }
  protected respond(c: ContributionView) {
    return this.act(() => this.api.respond(this.context.active()!.id, c.id, this.reply.trim()), t('Answer sent; the suggestion is back in review.'));
  }
  protected withdraw(c: ContributionView) {
    return this.act(() => this.api.withdraw(this.context.active()!.id, c.id), t('Suggestion withdrawn.'));
  }
}
