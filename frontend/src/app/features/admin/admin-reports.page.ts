import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { REPORT_REASON_LABELS, type PageMeta, type ReportStatus, type ReportView } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { LifecycleApi } from '../../core/lifecycle/lifecycle.api';
import { AlertComponent } from '../../shared/ui/alert.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

interface Draft {
  resolution: string;
  notify: boolean;
  suspend: boolean;
}

/** Platform review of abuse reports. Shows what was reported (as named at the time), never the family's records. */
@Component({
  selector: 'fh-admin-reports-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DatePipe, RouterLink, AlertComponent, SpinnerComponent, TranslatePipe],
  template: `
    <header class="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-3xl font-semibold">{{ 'Reports' | t }}</h1>
        <p class="mt-1 max-w-2xl text-sm text-stone-500">{{ "Content people reported. You see what was reported and why; the family's records stay private. Ask the family's administrators to act, suspend the family, or dismiss the report." | t }}</p>
      </div>
      <a routerLink="/admin" class="btn-secondary">{{ 'Accounts & families' | t }}</a>
    </header>
    <div role="tablist" [attr.aria-label]="'Report status' | t" class="mb-5 flex gap-1 border-b border-stone-200 dark:border-stone-800">
      @for (tab of tabs; track tab.id) {
        <button type="button" role="tab" [attr.aria-selected]="status() === tab.id" class="-mb-px border-b-2 px-4 py-2 text-sm font-medium"
                [class]="status() === tab.id ? 'border-brand-700 text-brand-800 dark:border-brand-300 dark:text-brand-200' : 'border-transparent text-stone-500'" (click)="show(tab.id)">{{ tab.label }}</button>
      }
    </div>
    @if (message(); as m) { <fh-alert [tone]="m.tone" class="mb-4">{{ m.text }}</fh-alert> }
    @if (reports() === null) {
      <fh-spinner [showLabel]="true" />
    } @else {
      <ul class="space-y-4">
        @for (r of reports(); track r.id) {
          <li class="card p-5">
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 class="font-semibold">{{ r.targetLabel }}</h2>
              <span class="text-sm text-stone-500">{{ 'in {name}' | t: { name: r.family?.name ?? ('a family that has since been deleted' | t) } }}@if (r.family && r.family.status !== 'active') { ({{ r.family.status }}) }</span>
              <span class="ml-auto text-xs text-stone-500">{{ r.createdAt | date: 'medium' }}</span>
            </div>
            <p class="mt-2 text-sm"><span class="badge bg-gold-100 text-gold-700">{{ reasonLabels[r.reason] | t }}</span></p>
            <p class="mt-2 whitespace-pre-line text-sm text-stone-700 dark:text-stone-300">{{ r.details }}</p>
            <p class="mt-2 text-xs text-stone-500">{{ 'Reported by {name}' | t: { name: r.reporter ? r.reporter.displayName + ' <' + r.reporter.email + '>' : ('a deleted account' | t) } }}</p>
            @if (r.status === 'open') {
              <form class="mt-4 space-y-3 border-t border-stone-200 pt-4 dark:border-stone-800" (submit)="$event.preventDefault()">
                <div>
                  <label class="label" [for]="'res-' + r.id">{{ "Decision (sent to the reporter, and to the family's administrators if notified)" | t }}</label>
                  <textarea class="input min-h-20" [id]="'res-' + r.id" [name]="'res-' + r.id" maxlength="5000" [(ngModel)]="draft(r).resolution"></textarea>
                </div>
                <div class="flex flex-wrap gap-4 text-sm">
                  <label class="flex items-center gap-2"><input type="checkbox" class="accent-brand-700" [name]="'n-' + r.id" [(ngModel)]="draft(r).notify" [disabled]="!r.family" /> {{ "Ask the family's administrators to act" | t }}</label>
                  <label class="flex items-center gap-2"><input type="checkbox" class="accent-red-700" [name]="'s-' + r.id" [(ngModel)]="draft(r).suspend" [disabled]="r.family?.status !== 'active'" /> {{ 'Suspend the family' | t }}</label>
                </div>
                <div class="flex gap-2">
                  <button type="button" class="btn-primary" [disabled]="busy() || draft(r).resolution.trim().length < 3" (click)="resolve(r, 'resolved')">{{ 'Resolve' | t }}</button>
                  <button type="button" class="btn-secondary" [disabled]="busy() || draft(r).resolution.trim().length < 3" (click)="resolve(r, 'dismissed')">{{ 'Dismiss' | t }}</button>
                </div>
              </form>
            } @else {
              <p class="mt-3 border-t border-stone-200 pt-3 text-sm dark:border-stone-800"><strong>{{ r.status === 'resolved' ? ('Resolved' | t) : ('Dismissed' | t) }}</strong> {{ r.resolvedAt | date: 'medium' }}: {{ r.resolution }}@if (r.actions.length) { <span class="text-stone-500"> · {{ r.actions.join(', ').replaceAll('_', ' ') }}</span> }</p>
            }
          </li>
        } @empty {
          <li class="card p-8 text-center text-sm text-stone-500">{{ status() === 'open' ? ('No open reports.' | t) : status() === 'resolved' ? ('No resolved reports.' | t) : ('No dismissed reports.' | t) }}</li>
        }
      </ul>
      @if (meta(); as m) {
        @if (m.totalPages > 1) {
          <nav class="mt-4 flex justify-between text-sm" [attr.aria-label]="'Pagination' | t">
            <button type="button" class="btn-secondary" [disabled]="m.page <= 1" (click)="load(m.page - 1)">{{ 'Previous' | t }}</button>
            <span class="text-stone-500">{{ 'Page {page} of {total}' | t: { page: m.page, total: m.totalPages } }}</span>
            <button type="button" class="btn-secondary" [disabled]="m.page >= m.totalPages" (click)="load(m.page + 1)">{{ 'Next' | t }}</button>
          </nav>
        }
      }
    }
  `,
})
export class AdminReportsPage {
  private readonly api = inject(LifecycleApi);
  protected readonly tabs: { id: ReportStatus; label: string }[] = [
    { id: 'open', label: t('Waiting') },
    { id: 'resolved', label: t('Resolved') },
    { id: 'dismissed', label: t('Dismissed') },
  ];
  protected readonly reasonLabels = REPORT_REASON_LABELS;
  protected readonly status = signal<ReportStatus>('open');
  protected readonly reports = signal<ReportView[] | null>(null);
  protected readonly meta = signal<PageMeta | null>(null);
  protected readonly busy = signal(false);
  protected readonly message = signal<{ tone: 'success' | 'error'; text: string } | null>(null);
  private readonly drafts = new Map<string, Draft>();

  constructor() {
    void this.load(1);
  }

  protected draft(r: ReportView): Draft {
    let d = this.drafts.get(r.id);
    if (!d) this.drafts.set(r.id, (d = { resolution: '', notify: false, suspend: false }));
    return d;
  }

  protected show(status: ReportStatus): void {
    this.status.set(status);
    void this.load(1);
  }

  protected async load(page: number): Promise<void> {
    try {
      const res = await this.api.reports(this.status(), page);
      this.reports.set(res.data);
      this.meta.set(res.meta);
    } catch (err) {
      this.reports.set([]);
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
    }
  }

  protected async resolve(r: ReportView, status: 'resolved' | 'dismissed'): Promise<void> {
    const d = this.draft(r);
    this.busy.set(true);
    try {
      await this.api.resolveReport(r.id, { status, resolution: d.resolution.trim(), notifyFamilyAdmins: d.notify, suspendFamily: d.suspend });
      this.message.set({ tone: 'success', text: status === 'resolved' ? t('Report resolved.') : t('Report dismissed.') });
      await this.load(this.meta()?.page ?? 1);
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
    } finally {
      this.busy.set(false);
    }
  }
}
