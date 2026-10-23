import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { FormArray, FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucidePlus, LucideX } from '@lucide/angular';
import {
  ARCHIVE_PRIVACY,
  ARCHIVE_PRIVACY_LABELS,
  CEREMONY_KINDS,
  EVENT_KIND_LABELS,
  type ArchivePrivacy,
  type CeremonyKind,
  type EventInput,
  type EventView,
  type FundView,
  type PersonCard,
} from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { ArchiveApi } from '../../core/archive/archive.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { FamilyLifeApi } from '../../core/family-life/family-life.api';
import { mark, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AlertComponent } from '../../shared/ui/alert.component';
import { fuzzyDateForm, fuzzyDateValue, FuzzyDateFieldComponent } from '../../shared/ui/fuzzy-date-field.component';
import { PeopleFieldComponent } from '../../shared/ui/people-field.component';
import { PersonPickerComponent } from '../../shared/ui/person-picker.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';

type ProgrammeRow = FormGroup<{ time: FormControl<string>; title: FormControl<string>; lead: FormControl<string>; detail: FormControl<string> }>;
interface RoleRow {
  role: FormControl<string>;
  person: PersonCard | null;
  name: FormControl<string>;
}

/** Suggested programmes, so planning a common ceremony starts from something familiar. */
const STARTERS: Partial<Record<CeremonyKind, { time: string; title: string }[]>> = {
  naming: [{ time: mark('Dawn'), title: mark('Naming and blessing with water and schnapps') }, { time: '', title: mark('The name is announced') }, { time: '', title: mark('Prayers and gifts') }],
  funeral: [
    { time: mark('Friday'), title: mark('Wake keeping') },
    { time: mark('Saturday morning'), title: mark('Lying in state') },
    { time: '', title: mark('Burial service') },
    { time: '', title: mark('Burial') },
    { time: mark('Afternoon'), title: mark('Funeral rites and donations') },
    { time: mark('Sunday'), title: mark('Thanksgiving service') },
  ],
  engagement: [{ time: '', title: mark('Arrival of the groom’s family') }, { time: '', title: mark('Knocking and introductions') }, { time: '', title: mark('Presentation of the items') }, { time: '', title: mark('Prayers and blessing') }],
  wedding: [{ time: '', title: mark('Ceremony') }, { time: '', title: mark('Photographs') }, { time: '', title: mark('Reception') }],
};

@Component({
  selector: 'fh-ceremony-edit-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, AlertComponent, SpinnerComponent, FuzzyDateFieldComponent, PeopleFieldComponent, PersonPickerComponent, LucidePlus, LucideX, TranslatePipe],
  template: `
    <a [routerLink]="id() ? ['/ceremonies', id()] : ['/ceremonies']" class="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">← {{ 'Back' | t }}</a>
    <h1 class="mt-2 text-3xl font-semibold">{{ id() ? ('Edit ceremony' | t) : ('Plan a ceremony' | t) }}</h1>
    @if (error(); as e) { <fh-alert class="mt-4 block">{{ e }}</fh-alert> }
    @if (!context.can('event.manage')) {
      <fh-alert tone="info" class="mt-4 block">{{ 'Administrators and moderators record ceremonies.' | t }}</fh-alert>
    } @else if (loading()) {
      <fh-spinner class="mt-6" [showLabel]="true" />
    } @else {
      <form class="mt-6 space-y-6" [formGroup]="form" (submit)="$event.preventDefault(); save()">
        <section class="card space-y-4 p-6">
          <div class="grid gap-4 sm:grid-cols-[16rem_1fr]">
            <div>
              <label class="label" for="c-kind">{{ 'Ceremony' | t }}</label>
              <select id="c-kind" class="input" formControlName="kind">
                @for (k of kinds; track k) { <option [value]="k">{{ kindLabels[k] | t }}</option> }
              </select>
            </div>
            <div>
              <label class="label" for="c-title">{{ 'Title' | t }}</label>
              <input id="c-title" class="input" formControlName="title" maxlength="200" [placeholder]="'e.g. Outdooring of Kwame’s daughter' | t" />
            </div>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <fh-fuzzy-date-field [label]="'Date' | t" [form]="date" />
            <div><label class="label" for="c-place">{{ 'Where' | t }}</label><input id="c-place" class="input" formControlName="place" maxlength="200" [placeholder]="'e.g. Family house, Kumasi' | t" /></div>
          </div>
          <fh-people-field [familyId]="familyId()" [label]="'Who it is for (the child, the couple, the deceased…)' | t" [(value)]="people" />
          <div><label class="label" for="c-desc">{{ 'About the ceremony' | t }}</label><textarea id="c-desc" class="input min-h-24" formControlName="description" maxlength="20000"></textarea></div>
        </section>

        <section class="card space-y-3 p-6" aria-labelledby="prog-h">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 id="prog-h" class="text-lg font-semibold">{{ 'Programme' | t }}</h2>
            <div class="flex gap-2">
              @if (!programme.length && starter()) { <button type="button" class="btn-secondary !py-1.5 text-sm" (click)="useStarter()">{{ 'Start from a typical programme' | t }}</button> }
              <button type="button" class="btn-secondary !py-1.5 text-sm" (click)="addItem()"><svg lucidePlus class="size-4"></svg> {{ 'Add a part' | t }}</button>
            </div>
          </div>
          @for (row of programme.controls; track row; let i = $index) {
            <div class="grid gap-2 rounded-xl border border-stone-200 p-3 sm:grid-cols-[8rem_1fr_12rem_auto] dark:border-stone-800" [formGroup]="row">
              <input class="input" formControlName="time" [placeholder]="'Time' | t" [attr.aria-label]="'Time of part {n}' | t: { n: i + 1 }" maxlength="40" />
              <input class="input" formControlName="title" [placeholder]="'What happens' | t" [attr.aria-label]="'Part {n}' | t: { n: i + 1 }" maxlength="200" />
              <input class="input" formControlName="lead" [placeholder]="'Led by' | t" [attr.aria-label]="'Who leads part {n}' | t: { n: i + 1 }" maxlength="120" />
              <button type="button" class="btn-ghost !p-2" (click)="programme.removeAt(i)" [attr.aria-label]="'Remove part {n}' | t: { n: i + 1 }"><svg lucideX class="size-4"></svg></button>
              <input class="input sm:col-span-3 sm:col-start-2" formControlName="detail" [placeholder]="'Details (optional)' | t" [attr.aria-label]="'Details of part {n}' | t: { n: i + 1 }" maxlength="1000" />
            </div>
          }
        </section>

        <section class="card space-y-3 p-6" aria-labelledby="roles-h">
          <div class="flex items-center justify-between gap-2">
            <h2 id="roles-h" class="text-lg font-semibold">{{ 'Roles' | t }}</h2>
            <button type="button" class="btn-secondary !py-1.5 text-sm" (click)="addRole()"><svg lucidePlus class="size-4"></svg> {{ 'Add a role' | t }}</button>
          </div>
          <p class="text-sm text-stone-500">{{ 'Chief mourner, family spokesperson (okyeame), MC, officiating minister, godparents… Choose someone in the family tree, or type a name.' | t }}</p>
          @for (r of roles(); track r; let i = $index) {
            <div class="grid items-end gap-2 rounded-xl border border-stone-200 p-3 sm:grid-cols-[12rem_1fr_1fr_auto] dark:border-stone-800">
              <div><label class="label" [for]="'role-' + i">{{ 'Role' | t }}</label><input class="input" [id]="'role-' + i" [formControl]="r.role" maxlength="80" /></div>
              <fh-person-picker [familyId]="familyId()" [label]="'Person in the tree' | t" [value]="r.person" (picked)="r.person = $event" />
              <div><label class="label" [for]="'rname-' + i">{{ 'Or a name' | t }}</label><input class="input" [id]="'rname-' + i" [formControl]="r.name" maxlength="120" [placeholder]="r.person ? r.person.displayName : ('e.g. Rev. Asare' | t)" /></div>
              <button type="button" class="btn-ghost !p-2" (click)="removeRole(i)" [attr.aria-label]="'Remove role {n}' | t: { n: i + 1 }"><svg lucideX class="size-4"></svg></button>
            </div>
          }
        </section>

        <section class="card grid gap-4 p-6 sm:grid-cols-2">
          @if (funds().length) {
            <div>
              <label class="label" for="c-fund">{{ 'Contributions go to' | t }}</label>
              <select id="c-fund" class="input" formControlName="fundId">
                <option value="">{{ 'No fund' | t }}</option>
                @for (f of funds(); track f.id) { <option [value]="f.id">{{ f.name }}</option> }
              </select>
            </div>
          }
          <div>
            <label class="label" for="c-privacy">{{ 'Who can see it' | t }}</label>
            <select id="c-privacy" class="input" formControlName="privacy">
              @for (p of privacyOptions; track p) { <option [value]="p">{{ privacyLabels[p] | t }}</option> }
            </select>
          </div>
        </section>

        <div class="flex gap-2">
          <button type="submit" class="btn-primary" [disabled]="busy() || form.invalid">{{ id() ? ('Save' | t) : ('Save the ceremony' | t) }}</button>
          <a [routerLink]="id() ? ['/ceremonies', id()] : ['/ceremonies']" class="btn-secondary">{{ 'Cancel' | t }}</a>
        </div>
      </form>
    }
  `,
})
export class CeremonyEditPage {
  /** Route parameter when editing. */
  readonly id = input<string>();

  protected readonly context = inject(FamilyContextStore);
  private readonly archive = inject(ArchiveApi);
  private readonly life = inject(FamilyLifeApi);
  private readonly router = inject(Router);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly kinds = CEREMONY_KINDS;
  protected readonly kindLabels = EVENT_KIND_LABELS;
  protected readonly privacyOptions = ARCHIVE_PRIVACY;
  protected readonly privacyLabels = ARCHIVE_PRIVACY_LABELS;
  protected readonly form = this.fb.group({
    kind: this.fb.control<CeremonyKind>('naming'),
    title: ['', [Validators.required, Validators.maxLength(200)]],
    place: [''],
    description: [''],
    fundId: [''],
    privacy: this.fb.control<ArchivePrivacy>('family'),
  });
  protected readonly date = fuzzyDateForm(null);
  protected readonly programme = new FormArray<ProgrammeRow>([]);
  protected readonly roles = signal<RoleRow[]>([]);
  protected people: PersonCard[] = [];
  protected readonly funds = signal<FundView[]>([]);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private existing: EventView | null = null;

  protected familyId(): string {
    return this.context.active()?.id ?? '';
  }

  constructor() {
    effect(() => {
      const family = this.context.active();
      const id = this.id();
      if (family) untracked(() => void this.load(family.id, id));
    });
  }

  private async load(familyId: string, id: string | undefined): Promise<void> {
    if (this.context.can('finance.view')) this.funds.set(await this.life.funds(familyId).catch(() => []));
    if (!id) return;
    this.loading.set(true);
    try {
      const c = await this.archive.event(familyId, id);
      this.existing = c;
      this.form.reset({ kind: c.kind as CeremonyKind, title: c.title, place: c.place, description: c.description, fundId: c.fund?.id ?? '', privacy: c.privacy });
      const d = fuzzyDateForm(c.date);
      this.date.setValue(d.getRawValue());
      this.people = c.people;
      this.programme.clear();
      for (const p of c.programme) this.programme.push(this.row(p));
      this.roles.set(c.roles.map((r) => ({ role: new FormControl(r.role, { nonNullable: true }), person: r.person, name: new FormControl(r.person ? '' : r.name, { nonNullable: true }) })));
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.loading.set(false);
    }
  }

  private row(p: { time?: string; title?: string; lead?: string; detail?: string } = {}): ProgrammeRow {
    return this.fb.group({ time: [p.time ?? ''], title: [p.title ?? '', Validators.required], lead: [p.lead ?? ''], detail: [p.detail ?? ''] });
  }

  protected starter(): { time: string; title: string }[] | undefined {
    return STARTERS[this.form.controls.kind.value];
  }
  protected useStarter(): void {
    for (const s of this.starter() ?? []) this.programme.push(this.row({ time: s.time ? t(s.time) : '', title: t(s.title) }));
  }
  protected addItem(): void {
    this.programme.push(this.row());
  }
  protected addRole(): void {
    this.roles.update((r) => [...r, { role: new FormControl('', { nonNullable: true }), person: null, name: new FormControl('', { nonNullable: true }) }]);
  }
  protected removeRole(i: number): void {
    this.roles.update((r) => r.filter((_, j) => j !== i));
  }

  protected async save(): Promise<void> {
    const v = this.form.getRawValue();
    const roles = this.roles().filter((r) => r.role.value.trim());
    if (roles.some((r) => !r.person && !r.name.value.trim())) {
      this.error.set(t('Each role needs a person from the tree or a name.'));
      return;
    }
    const body: EventInput = {
      kind: v.kind,
      title: v.title.trim(),
      date: fuzzyDateValue(this.date),
      place: v.place.trim(),
      description: v.description.trim(),
      memberIds: this.people.map((p) => p.id),
      privacy: v.privacy,
      programme: this.programme.getRawValue().filter((p) => p.title.trim()).map((p) => ({ time: p.time.trim(), title: p.title.trim(), ...(p.lead.trim() ? { lead: p.lead.trim() } : {}), ...(p.detail.trim() ? { detail: p.detail.trim() } : {}) })),
      roles: roles.map((r) => ({ role: r.role.value.trim(), memberId: r.person?.id ?? null, name: r.name.value.trim() })),
      ...(this.funds().length ? { fundId: v.fundId || null } : {}),
    };
    this.busy.set(true);
    this.error.set(null);
    try {
      const familyId = this.familyId();
      const saved = this.existing ? await this.archive.updateEvent(familyId, this.existing.id, { ...body, version: this.existing.version }) : await this.archive.createEvent(familyId, body);
      await this.router.navigate(['/ceremonies', saved.id]);
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
