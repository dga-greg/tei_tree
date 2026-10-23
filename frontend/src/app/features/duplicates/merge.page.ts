import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LucideArrowLeftRight, LucideGitMerge } from '@lucide/angular';
import { MERGE_FIELDS, MERGE_FIELD_LABELS, type FuzzyDate, type MemberView, type MergeChoices, type MergeField, type MergeView, type PersonCard } from '@fh/contracts';
import { formatFuzzyDate } from '../../shared/format';
import { ApiError } from '../../core/api/api-error';
import { DataToolsApi } from '../../core/data-tools/data-tools.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { MembersApi } from '../../core/members/members.api';
import { lifespan } from '../../shared/people';
import { AlertComponent } from '../../shared/ui/alert.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { PersonAvatarComponent } from '../../shared/ui/person-avatar.component';
import { PersonPickerComponent } from '../../shared/ui/person-picker.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { mark, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

interface Row {
  field: MergeField;
  label: string;
  keep: string;
  other: string;
  /** Both records say the same, so there is nothing to choose. */
  same: boolean;
}

const GENDERS: Record<string, string> = { male: mark('Male'), female: mark('Female'), non_binary: mark('Non-binary'), other: mark('Other'), undisclosed: mark('Prefer not to say') };
const VITAL: Record<string, string> = { living: mark('Living'), deceased: mark('Deceased'), unknown: mark('Not known') };

function show(field: MergeField, m: MemberView): string {
  const v = (m as unknown as Record<string, unknown>)[field];
  if (field === 'birthDate' || field === 'deathDate') return formatFuzzyDate(v as FuzzyDate | null);
  if (field === 'gender') return v ? (GENDERS[v as string] ? t(GENDERS[v as string]!) : String(v)) : '';
  if (field === 'vitalStatus') return v ? (VITAL[v as string] ? t(VITAL[v as string]!) : String(v)) : '';
  if (field === 'profilePhotoMediaId') return v ? t('Photo') : '';
  if (field === 'biography') return v ? `${String(v).slice(0, 160)}${String(v).length > 160 ? '…' : ''}` : '';
  return v == null ? '' : String(v);
}

/** Compares two records of the same person and merges the second into the first. */
@Component({
  selector: 'fh-merge-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AlertComponent, NoFamilyComponent, PersonAvatarComponent, PersonPickerComponent, SpinnerComponent, LucideArrowLeftRight, LucideGitMerge, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else if (!context.can('member.merge')) {
      <fh-alert tone="info">{{ "Only the family's administrators can merge people." | t }}</fh-alert>
    } @else {
      <a routerLink="/members/duplicates" class="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">← {{ 'Possible duplicates' | t }}</a>
      <h1 class="mt-2 text-3xl font-semibold">{{ 'Merge two records' | t }}</h1>
      <p class="mt-1 max-w-3xl text-sm text-stone-500">
        {{ 'When the same person was recorded twice, merge the records: you choose which details to keep, and everything linked to either record — parents, children, partners, photos, stories, events and a claimed account — ends up on one person. The merge is recorded in the change history and can be undone.' | t }}
      </p>

      @if (error(); as e) { <fh-alert class="mt-4 block">{{ e }}</fh-alert> }

      @if (done(); as d) {
        <fh-alert tone="success" class="mt-6 block">{{ '{other} was merged into {keep}.' | t: { other: d.otherName, keep: d.keep?.displayName } }} {{ '{links, plural, one {# family link} other {# family links}} and {items, plural, one {# photo, story or event} other {# photos, stories or events}} moved.' | t: { links: d.linksMoved, items: d.itemsMoved } }}</fh-alert> <!-- i18n-ignore -->
        <div class="mt-4 flex flex-wrap gap-2">
          <a class="btn-primary" [routerLink]="['/members', d.keep?.id]">{{ 'Open the profile' | t }}</a>
          <button type="button" class="btn-secondary" (click)="undo(d)" [disabled]="busy()">{{ 'Undo the merge' | t }}</button>
          <a class="btn-secondary" routerLink="/members/duplicates">{{ 'More possible duplicates' | t }}</a>
        </div>
      } @else if (!keep()) {
        <fh-spinner class="mt-6" [showLabel]="true" />
      } @else {
        @if (!other()) {
          <section class="card mt-6 max-w-xl p-6">
            <p class="text-sm">{{ 'Which record is the same person as' | t }} <strong>{{ keep()!.displayName }}</strong>?</p>
            <div class="mt-3"><fh-person-picker [familyId]="context.active()!.id" [label]="'The other record' | t" [exclude]="[keep()!.id]" (picked)="pickOther($event)" /></div>
          </section>
        } @else {
          <div class="mt-6 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
            @for (p of [keep()!, other()!]; track p.id; let first = $first) {
              <div class="card flex items-center gap-3 p-4" [class.border-brand-500]="first">
                <fh-person-avatar [name]="p.displayName" [photoUrl]="p.photoUrl" />
                <div class="min-w-0">
                  <p class="text-xs uppercase tracking-wide text-stone-500">{{ (first ? 'Keep this record' : 'Merge into it and remove') | t }}</p>
                  <a class="block truncate font-medium hover:underline" [routerLink]="['/members', p.id]">{{ p.displayName }}</a>
                  <p class="text-sm text-stone-500">{{ life(p) }}</p>
                </div>
              </div>
              @if (first) {
                <button type="button" class="btn-ghost justify-self-center" (click)="swap()" [attr.aria-label]="'Keep the other record instead' | t"><svg lucideArrowLeftRight class="size-5"></svg></button>
              }
            }
          </div>

          <section class="card mt-6 overflow-hidden" aria-labelledby="fields-h">
            <h2 id="fields-h" class="px-5 pt-5 text-lg font-semibold">{{ 'Choose the details to keep' | t }}</h2>
            <p class="px-5 pt-1 text-sm text-stone-500">{{ 'Education, work, achievements, sources and other names from both records are combined. The stricter privacy setting applies.' | t }}</p>
            <div class="mt-4 overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500 dark:bg-stone-900">
                  <tr><th scope="col" class="px-5 py-2">{{ 'Detail' | t }}</th><th scope="col" class="px-5 py-2">{{ keep()!.displayName }}</th><th scope="col" class="px-5 py-2">{{ other()!.displayName }}</th></tr>
                </thead>
                <tbody class="divide-y divide-stone-200 dark:divide-stone-800">
                  @for (r of rows(); track r.field) {
                    <tr>
                      <th scope="row" class="px-5 py-3 text-left font-medium">{{ r.label | t }}</th>
                      @if (r.same) {
                        <td class="px-5 py-3" colspan="2">{{ r.keep || '—' }} <span class="text-xs text-stone-500">{{ '(the same in both)' | t }}</span></td>
                      } @else {
                        @for (side of sides; track side) {
                          <td class="px-5 py-3">
                            <label class="flex cursor-pointer items-start gap-2">
                              <input type="radio" class="mt-1 accent-brand-700" [name]="'f-' + r.field" [checked]="choice(r.field) === side" (change)="setChoice(r.field, side)" />
                              <span [class.text-stone-400]="!(side === 'keep' ? r.keep : r.other)">{{ (side === 'keep' ? r.keep : r.other) || ('Empty' | t) }}</span>
                            </label>
                          </td>
                        }
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>

          <section class="card mt-6 space-y-3 p-6" aria-labelledby="links-h">
            <h2 id="links-h" class="text-lg font-semibold">{{ 'Family links' | t }}</h2>
            <p class="text-sm text-stone-600 dark:text-stone-300">{{ linkSummary() }}</p>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn-primary" (click)="merge()" [disabled]="busy()"><svg lucideGitMerge class="size-4"></svg> {{ 'Merge into {name}' | t: { name: keep()!.displayName } }}</button>
              <a class="btn-secondary" routerLink="/members/duplicates">{{ 'Cancel' | t }}</a>
            </div>
          </section>
        }
      }
    }
  `,
})
export class MergePage {
  /** Route parameter: the record to keep. */
  readonly id = input.required<string>();
  /** Query parameter: the record to merge into it. */
  readonly with = input<string>();

  protected readonly context = inject(FamilyContextStore);
  private readonly members = inject(MembersApi);
  private readonly api = inject(DataToolsApi);
  private readonly router = inject(Router);

  protected readonly sides = ['keep', 'other'] as const;
  protected readonly keep = signal<MemberView | null>(null);
  protected readonly other = signal<MemberView | null>(null);
  protected readonly choices = signal<MergeChoices>({});
  protected readonly done = signal<MergeView | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly life = lifespan;

  protected readonly rows = computed<Row[]>(() => {
    const k = this.keep();
    const o = this.other();
    if (!k || !o) return [];
    return MERGE_FIELDS.map((field) => ({ field, label: MERGE_FIELD_LABELS[field], keep: show(field, k), other: show(field, o) }))
      .filter((r) => r.keep || r.other)
      .map((r) => ({ ...r, same: r.keep === r.other && (r.field !== 'profilePhotoMediaId' || k.profilePhotoMediaId === o.profilePhotoMediaId) }));
  });

  protected readonly linkSummary = computed(() => {
    const o = this.other();
    const k = this.keep();
    if (!o || !k) return '';
    const r = o.relatives;
    const parts = [
      r.parents.length && t('{count, plural, one {# parent} other {# parents}}', { count: r.parents.length }),
      r.children.length && t('{count, plural, one {# child} other {# children}}', { count: r.children.length }),
      r.partners.length && t('{count, plural, one {# partner} other {# partners}}', { count: r.partners.length }),
    ].filter(Boolean);
    return parts.length
      ? t(
          "{name}'s {links} will be linked to {other}. Links both records already share are kept once. The merge is refused if it would give someone more than two birth parents or make anyone their own ancestor.",
          { name: o.displayName, links: parts.join(', '), other: k.displayName },
        )
      : t('{name} has no family links of their own.', { name: o.displayName });
  });

  constructor() {
    effect(() => {
      const family = this.context.active();
      const keepId = this.id();
      const otherId = this.with();
      if (!family) return;
      untracked(() => void this.load(family.id, keepId, otherId));
    });
  }

  private async load(familyId: string, keepId: string, otherId: string | undefined): Promise<void> {
    this.error.set(null);
    this.done.set(null);
    try {
      const [k, o] = await Promise.all([this.members.get(familyId, keepId), otherId ? this.members.get(familyId, otherId) : Promise.resolve(null)]);
      this.keep.set(k);
      this.other.set(o);
      // Start from the kept record's details, taking the other's where the kept one is empty.
      const start: MergeChoices = {};
      if (o) for (const f of MERGE_FIELDS) if (!show(f, k) && show(f, o)) start[f] = 'other';
      this.choices.set(start);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    }
  }

  protected choice(field: MergeField): 'keep' | 'other' {
    return this.choices()[field] ?? 'keep';
  }
  protected setChoice(field: MergeField, side: 'keep' | 'other'): void {
    this.choices.update((c) => ({ ...c, [field]: side }));
  }

  protected pickOther(p: PersonCard | null): void {
    if (p) void this.router.navigate(['/members', this.id(), 'merge'], { queryParams: { with: p.id } });
  }

  protected swap(): void {
    const o = this.other();
    if (o) void this.router.navigate(['/members', o.id, 'merge'], { queryParams: { with: this.id() } });
  }

  protected async merge(): Promise<void> {
    const k = this.keep();
    const o = this.other();
    if (!k || !o) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.done.set(await this.api.merge(this.context.active()!.id, k.id, { otherId: o.id, choices: this.choices(), keepVersion: k.version ?? 0, otherVersion: o.version ?? 0 }));
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }

  protected async undo(d: MergeView): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.undoMerge(this.context.active()!.id, d.id);
      await this.load(this.context.active()!.id, this.id(), this.with());
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
