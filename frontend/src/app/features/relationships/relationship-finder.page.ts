import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucideArrowLeftRight, LucideArrowRight, LucideCircleCheck, LucideNetwork, LucideTriangleAlert } from '@lucide/angular';
import type { KinshipResult, PersonCard } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { mark, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { MembersApi } from '../../core/members/members.api';
import { lifespan } from '../../shared/people';
import { AlertComponent } from '../../shared/ui/alert.component';
import { GenerationBadgeComponent } from '../../shared/ui/generation-badge.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { PersonPickerComponent } from '../../shared/ui/person-picker.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';

const KIND_LABELS: Record<KinshipResult['kind'], string> = {
  self: mark('Same person'),
  blood: mark('Blood relatives'),
  partner: mark('Partners'),
  marriage: mark('Related by marriage'),
  step: mark('Step relation'),
  not_found: mark('No recorded connection'),
};

@Component({
  selector: 'fh-relationship-finder-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    PersonPickerComponent,
    PersonAvatarComponent,
    GenerationBadgeComponent,
    AlertComponent,
    SpinnerComponent,
    NoFamilyComponent,
    LucideArrowLeftRight,
    LucideArrowRight,
    LucideCircleCheck,
    LucideTriangleAlert,
    LucideNetwork,
    TranslatePipe,
  ],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else {
      <header class="mb-6">
        <h1 class="text-3xl font-semibold">{{ 'Relationship finder' | t }}</h1>
        <p class="mt-1 max-w-2xl text-sm text-stone-500">
          {{ 'Choose two people to see how they are related, through which ancestors, and by which links. Only recorded relationships are used — nothing is guessed.' | t }}
        </p>
      </header>

      <section class="card grid items-end gap-4 p-5 md:grid-cols-[1fr_auto_1fr]" [attr.aria-label]="'Choose two people' | t">
        <fh-person-picker [familyId]="context.active()!.id" [label]="'First person' | t" [value]="first()" (picked)="setFirst($event)" />
        <button type="button" class="btn-ghost mx-auto !p-2.5" (click)="swap()" [disabled]="!first() && !second()" [attr.aria-label]="'Swap the two people' | t">
          <svg lucideArrowLeftRight class="size-5"></svg>
        </button>
        <fh-person-picker [familyId]="context.active()!.id" [label]="'Second person' | t" [value]="second()" (picked)="setSecond($event)" />
      </section>

      @if (loading()) {
        <div class="mt-6"><fh-spinner [showLabel]="true" [label]="'Working out the relationship…' | t" /></div>
      } @else if (error(); as e) {
        <fh-alert class="mt-6">{{ e }}</fh-alert>
      } @else if (result(); as r) {
        <section class="card mt-6 overflow-hidden" aria-live="polite" aria-labelledby="answer-h">
          <div class="h-1.5 bg-gradient-to-r from-gold-300 via-brand-400 to-brand-700" aria-hidden="true"></div>
          <div class="p-6 sm:p-8">
            <div class="flex flex-wrap gap-2">
              <span class="badge bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200">{{ kindLabel(r.kind) }}</span>
              @if (r.kind !== 'not_found' && r.kind !== 'self') {
                @if (r.confidence === 'verified') {
                  <span class="badge bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200"><svg lucideCircleCheck class="size-3.5"></svg> {{ 'All links verified' | t }}</span>
                } @else {
                  <span class="badge bg-gold-100 text-gold-700"><svg lucideTriangleAlert class="size-3.5"></svg> {{ 'Includes unverified links' | t }}</span>
                }
              }
              @if (r.viaAdoption) { <span class="badge bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200">{{ 'Through adoption' | t }}</span> }
              @if (r.blood?.half) { <span class="badge bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200">{{ 'Half relationship' | t }}</span> }
              @if (r.alsoPartners) { <span class="badge bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-200">{{ 'Also partners' | t }}</span> }
            </div>
            <h2 id="answer-h" class="mt-4 text-2xl leading-snug font-semibold sm:text-3xl">{{ r.summary }}</h2>
            @if (r.reciprocal && r.kind !== 'not_found' && r.reciprocal !== 'related by marriage') {
              <p class="mt-2 text-stone-600 dark:text-stone-300">{{ '{name} is {owner} {relationship}.' | t: { name: r.b.displayName, owner: possessive(r.a.displayName), relationship: r.reciprocal } }}</p>
            }

            @if (r.path.steps.length) {
              <h3 class="mt-8 font-sans text-xs font-semibold uppercase tracking-wide text-stone-500">{{ 'The connection' | t }}</h3>
              <ol class="mt-3 flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center" [attr.aria-label]="'Relationship path' | t">
                @for (p of r.path.people; track p.id; let i = $index) {
                  <li class="flex flex-col gap-2 lg:flex-row lg:items-center">
                    <a [routerLink]="['/members', p.id]" class="flex items-center gap-2 rounded-xl border px-3 py-2 hover:shadow-(--shadow-card)"
                       [class]="isEnd(r, p.id) ? 'border-brand-600 bg-brand-50 dark:border-brand-700 dark:bg-brand-950' : isAncestor(r, p.id) ? 'border-gold-300 bg-gold-100/50 dark:border-gold-700 dark:bg-stone-900' : 'border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900'">
                      <fh-person-avatar [name]="p.displayName" size="sm" />
                      <span>
                        <span class="block text-sm font-semibold">{{ p.displayName }}</span>
                        <span class="block text-xs text-stone-500">{{ span(p) || '—' }}@if (isAncestor(r, p.id)) { · {{ 'common ancestor' | t }} }</span>
                      </span>
                    </a>
                    @if (r.path.steps[i]; as step) {
                      <span class="flex items-center gap-1.5 pl-4 text-xs text-stone-600 lg:pl-0 dark:text-stone-300">
                        <svg lucideArrowRight class="size-3.5 rotate-90 lg:rotate-0" aria-hidden="true"></svg>
                        <span>{{ "{name}'s {relationship}" | t: { name: firstName(p), relationship: step.label } }}@if (step.verification !== 'verified') { <span class="text-gold-700"> ({{ verificationLabel(step.verification) }})</span> }</span>
                      </span>
                    }
                  </li>
                }
              </ol>
            }

            <div class="mt-8 grid gap-6 lg:grid-cols-2">
              <section aria-labelledby="how-h">
                <h3 id="how-h" class="font-sans text-xs font-semibold uppercase tracking-wide text-stone-500">{{ 'How this was worked out' | t }}</h3>
                <ul class="mt-2 list-disc space-y-1.5 pl-5 text-sm text-stone-700 dark:text-stone-300">
                  @for (line of r.explanation; track $index) { <li>{{ line }}</li> }
                </ul>
              </section>
              @if (r.commonAncestors.length) {
                <section aria-labelledby="anc-h">
                  <h3 id="anc-h" class="font-sans text-xs font-semibold uppercase tracking-wide text-stone-500">{{ '{count, plural, one {Closest common ancestor} other {Closest common ancestors} }' | t: { count: r.commonAncestors.length } }}</h3>
                  <ul class="mt-2 space-y-2">
                    @for (p of r.commonAncestors; track p.id) {
                      <li class="flex items-center gap-3">
                        <fh-person-avatar [name]="p.displayName" size="sm" />
                        <a [routerLink]="['/members', p.id]" class="text-sm font-medium hover:underline">{{ p.displayName }}</a>
                        <fh-generation-badge [generation]="p.generation" />
                      </li>
                    }
                  </ul>
                </section>
              }
            </div>

            @if (r.path.people.length > 1) {
              <a routerLink="/tree" [queryParams]="{ path: r.a.id + ',' + r.b.id }" class="btn-secondary mt-8"><svg lucideNetwork class="size-4"></svg> {{ 'Show this path in the family tree' | t }}</a>
            }
          </div>
        </section>
      } @else {
        <p class="mt-6 text-sm text-stone-500">{{ 'Choose both people to see the answer.' | t }}</p>
      }
    }
  `,
})
export class RelationshipFinderPage {
  /** Query parameters for links such as "How are we related?" on a profile. */
  readonly a = input<string>();
  readonly b = input<string>();

  protected readonly context = inject(FamilyContextStore);
  private readonly membersApi = inject(MembersApi);
  private readonly router = inject(Router);

  protected readonly first = signal<PersonCard | null>(null);
  protected readonly second = signal<PersonCard | null>(null);
  protected readonly result = signal<KinshipResult | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly span = lifespan;
  private readonly ancestorIds = computed(() => new Set(this.result()?.commonAncestors.map((p) => p.id) ?? []));

  constructor() {
    // Load people named in the URL once the family is known.
    effect(() => {
      const family = this.context.active();
      const a = this.a();
      const b = this.b();
      if (!family) return;
      untracked(async () => {
        try {
          if (a && this.first()?.id !== a) this.first.set(await this.membersApi.get(family.id, a));
          if (b && this.second()?.id !== b) this.second.set(await this.membersApi.get(family.id, b));
        } catch {
          // A stale link; the user can pick again.
        }
        void this.run();
      });
    });
  }

  protected setFirst(p: PersonCard | null): void {
    this.first.set(p);
    this.sync();
  }

  protected setSecond(p: PersonCard | null): void {
    this.second.set(p);
    this.sync();
  }

  protected swap(): void {
    const a = this.first();
    this.first.set(this.second());
    this.second.set(a);
    this.sync();
  }

  /** Keeps the URL shareable, then recomputes. */
  private sync(): void {
    void this.router.navigate([], { queryParams: { a: this.first()?.id ?? null, b: this.second()?.id ?? null }, replaceUrl: true });
    void this.run();
  }

  private async run(): Promise<void> {
    const family = this.context.active();
    const a = this.first();
    const b = this.second();
    this.result.set(null);
    this.error.set(null);
    if (!family || !a || !b) return;
    this.loading.set(true);
    try {
      this.result.set(await this.membersApi.between(family.id, a.id, b.id));
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.loading.set(false);
    }
  }

  protected kindLabel(kind: KinshipResult['kind']): string {
    return t(KIND_LABELS[kind]);
  }

  protected possessive(name: string): string {
    return name.endsWith('s') ? t("{name}'", { name }) : t("{name}'s", { name });
  }

  protected verificationLabel(v: string): string {
    return v === 'unverified' ? t('unverified') : v === 'disputed' ? t('disputed') : v;
  }

  protected firstName(p: PersonCard): string {
    return p.firstName;
  }

  protected isEnd(r: KinshipResult, id: string): boolean {
    return id === r.a.id || id === r.b.id;
  }

  protected isAncestor(_r: KinshipResult, id: string): boolean {
    return this.ancestorIds().has(id);
  }
}
