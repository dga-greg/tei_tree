import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideGitFork, LucideNetwork, LucidePlus, LucideTrash2, LucideUsers } from '@lucide/angular';
import type { BranchView, PersonCard } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { TreeApi } from '../../core/tree/tree.api';
import { lifespan } from '../../shared/people';
import { AlertComponent } from '../../shared/ui/alert.component';
import { FormFieldComponent } from '../../shared/ui/form-field.component';
import { GenerationBadgeComponent } from '../../shared/ui/generation-badge.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonPickerComponent } from '../../shared/ui/person-picker.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';

/** Branches are descendant lines; membership is derived from relationships, never copied. */
@Component({
  selector: 'fh-branches-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, AlertComponent, SpinnerComponent, NoFamilyComponent, PersonPickerComponent, FormFieldComponent, GenerationBadgeComponent, LucideGitFork, LucidePlus, LucideNetwork, LucideUsers, LucideTrash2, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else {
      <header class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-3xl font-semibold">{{ 'Family branches' | t }}</h1>
          <p class="mt-1 max-w-2xl text-sm text-stone-500">
            {{ 'A branch is everyone descended from one person — usually a child of the founding ancestor. People are not copied into branches, and someone can belong to more than one.' | t }}
          </p>
        </div>
        @if (context.can('branch.manage')) {
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-secondary" [disabled]="busy()" (click)="fromFounder()">{{ 'Create a branch for each child of the founder' | t }}</button>
            <button type="button" class="btn-primary" (click)="adding.set(!adding())"><svg lucidePlus class="size-4"></svg> {{ 'New branch' | t }}</button>
          </div>
        }
      </header>

      @if (message(); as m) { <fh-alert [tone]="m.tone" class="mb-4">{{ m.text }}</fh-alert> }

      @if (adding()) {
        <form class="card mb-6 grid gap-4 p-5 lg:grid-cols-3" [formGroup]="form" (ngSubmit)="create()" novalidate [attr.aria-label]="'New branch' | t">
          <fh-person-picker [familyId]="context.active()!.id" [label]="'Founding member of the branch' | t" (picked)="founder.set($event)" />
          <fh-form-field [label]="'Branch name' | t" [control]="form.controls.name" #n>
            <input class="input" formControlName="name" [attr.id]="n.controlId" [placeholder]="'e.g. House of Kwame' | t" [attr.aria-describedby]="n.describedBy()" />
          </fh-form-field>
          <fh-form-field [label]="'Description' | t" [control]="form.controls.description" #d>
            <input class="input" formControlName="description" [attr.id]="d.controlId" />
          </fh-form-field>
          <div class="flex gap-2 lg:col-span-3">
            <button type="submit" class="btn-primary" [disabled]="!founder() || form.invalid || busy()">{{ 'Create branch' | t }}</button>
            <button type="button" class="btn-ghost" (click)="adding.set(false)">{{ 'Cancel' | t }}</button>
          </div>
        </form>
      }

      @if (branches() === null) {
        <fh-spinner [showLabel]="true" />
      } @else if (branches()!.length === 0) {
        <div class="card p-10 text-center text-stone-600 dark:text-stone-300">
          <svg lucideGitFork class="mx-auto mb-3 size-8 text-brand-700"></svg>
          <p class="font-medium">{{ 'No branches yet.' | t }}</p>
          <p class="mt-1 text-sm text-stone-500">{{ 'An administrator can create one for each child of the founding ancestor in one step.' | t }}</p>
        </div>
      } @else {
        <ul class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          @for (b of branches(); track b.id) {
            <li class="card flex flex-col p-5">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <h2 class="truncate text-lg font-semibold">{{ b.name }}</h2>
                  @if (b.founder; as f) {
                    <p class="text-sm text-stone-500">{{ 'From' | t }} <a [routerLink]="['/members', f.id]" class="font-medium text-brand-700 hover:underline dark:text-brand-300">{{ f.displayName }}</a> · {{ span(f) || '—' }}</p>
                  }
                </div>
                @if (b.founder; as f) { <fh-generation-badge [generation]="f.generation" /> }
              </div>
              @if (b.description) { <p class="mt-2 text-sm text-stone-600 dark:text-stone-300">{{ b.description }}</p> }
              <dl class="mt-4 grid grid-cols-3 gap-2 text-center">
                <div class="rounded-xl bg-stone-50 p-2 dark:bg-stone-800/60"><dt class="text-[11px] uppercase tracking-wide text-stone-500">{{ 'Descendants' | t }}</dt><dd class="text-xl font-semibold tabular-nums">{{ b.stats.descendantCount }}</dd></div>
                <div class="rounded-xl bg-stone-50 p-2 dark:bg-stone-800/60"><dt class="text-[11px] uppercase tracking-wide text-stone-500">{{ 'Generations' | t }}</dt><dd class="text-xl font-semibold tabular-nums">{{ b.stats.generationSpan }}</dd></div>
                <div class="rounded-xl bg-stone-50 p-2 dark:bg-stone-800/60"><dt class="text-[11px] uppercase tracking-wide text-stone-500">{{ 'Living' | t }}</dt><dd class="text-xl font-semibold tabular-nums">{{ b.stats.livingCount }}</dd></div>
              </dl>
              <div class="mt-4 flex flex-wrap gap-2">
                <a routerLink="/tree" [queryParams]="{ branch: b.id }" class="btn-secondary !py-1.5 text-sm"><svg lucideNetwork class="size-4"></svg> {{ 'View in tree' | t }}</a>
                <a routerLink="/members" [queryParams]="{ branchId: b.id }" class="btn-ghost !py-1.5 text-sm"><svg lucideUsers class="size-4"></svg> {{ 'People' | t }}</a>
                @if (context.can('branch.manage')) {
                  <button type="button" class="btn-ghost ml-auto !p-1.5 text-red-700 dark:text-red-400" (click)="remove(b)" [attr.aria-label]="'Delete branch {name}' | t: { name: b.name }"><svg lucideTrash2 class="size-4"></svg></button>
                }
              </div>
            </li>
          }
        </ul>
      }
    }
  `,
})
export class BranchesPage {
  protected readonly context = inject(FamilyContextStore);
  private readonly api = inject(TreeApi);
  protected readonly branches = signal<BranchView[] | null>(null);
  protected readonly adding = signal(false);
  protected readonly founder = signal<PersonCard | null>(null);
  protected readonly busy = signal(false);
  protected readonly message = signal<{ tone: 'success' | 'error'; text: string } | null>(null);
  protected readonly span = lifespan;
  protected readonly form = inject(NonNullableFormBuilder).group({ name: ['', [Validators.required, Validators.minLength(2)]], description: [''] });

  constructor() {
    effect(() => {
      const f = this.context.active();
      if (f) untracked(() => void this.load(f.id));
    });
  }

  private async load(familyId: string): Promise<void> {
    try {
      this.branches.set(await this.api.branches(familyId));
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
      this.branches.set([]);
    }
  }

  private async act(task: () => Promise<unknown>, success: string): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      await task();
      this.message.set({ tone: 'success', text: success });
      await this.load(this.context.active()!.id);
      void this.context.refresh();
    } catch (err) {
      this.message.set({ tone: 'error', text: ApiError.from(err).message });
    } finally {
      this.busy.set(false);
    }
  }

  protected fromFounder(): Promise<void> {
    return this.act(() => this.api.createBranchesForFounderChildren(this.context.active()!.id), t('Branches created for each child of the founding ancestor.'));
  }

  protected create(): Promise<void> {
    const f = this.founder();
    if (!f) return Promise.resolve();
    const v = this.form.getRawValue();
    return this.act(async () => {
      await this.api.createBranch(this.context.active()!.id, { name: v.name.trim(), description: v.description.trim(), foundingMemberId: f.id });
      this.adding.set(false);
      this.form.reset();
    }, t('Branch created.'));
  }

  protected remove(b: BranchView): Promise<void> {
    if (!confirm(t('Delete the branch “{name}”? People are not affected.', { name: b.name }))) return Promise.resolve();
    return this.act(() => this.api.removeBranch(this.context.active()!.id, b.id), t('Branch deleted.'));
  }
}
