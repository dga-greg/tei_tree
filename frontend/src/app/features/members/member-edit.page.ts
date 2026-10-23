import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  PARENT_CHILD_SUBTYPE_LABELS,
  PARENT_CHILD_SUBTYPES,
  PARTNERSHIP_SUBTYPE_LABELS,
  PARTNERSHIP_SUBTYPES,
  type CreateMemberRequest,
  type MemberView,
  type VerificationState,
} from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { ArchiveApi } from '../../core/archive/archive.api';
import { FamilyContextStore } from '../../core/families/family-context.store';
import { MembersApi } from '../../core/members/members.api';
import { AlertComponent } from '../../shared/ui/alert.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { memberForm, memberInputFrom, type MemberForm } from './member-fields';
import { MemberFieldsComponent } from './member-fields.component';
import { ProfilePhotoFieldComponent } from './profile-photo-field.component';
import { uploadProfilePhoto } from './profile-photo';
import { mark, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

type Relation = 'childOf' | 'parentOf' | 'partnerOf';

/** Shown on the person's page after saving (router state). */
export interface ProfileNotice {
  tone: 'info' | 'error';
  text: string;
}

/** Add a person (optionally already linked to a relative) or edit an existing one. */
@Component({
  selector: 'fh-member-edit-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, MemberFieldsComponent, ProfilePhotoFieldComponent, AlertComponent, SpinnerComponent, NoFamilyComponent, TranslatePipe],
  template: `
    @if (!context.active()) {
      @if (context.loaded()) { <fh-no-family /> } @else { <fh-spinner [showLabel]="true" /> }
    } @else if (loadError(); as e) {
      <fh-alert>{{ e }}</fh-alert>
    } @else if (form(); as f) {
      <header class="mb-6">
        <h1 class="text-3xl font-semibold">{{ heading() }}</h1>
        @if (existing()?.familyCode; as code) {
          <p class="mt-1 text-sm text-stone-500">{{ 'Family ID {code}' | t: { code } }}</p>
        }
        @if (relative(); as r) {
          <p class="mt-1 text-stone-600 dark:text-stone-400">{{ relationText() }} <strong>{{ r.displayName }}</strong>@if (r.familyCode) { ({{ r.familyCode }}) }.</p>
        } @else if (!existing()) {
          <p class="mt-1 text-sm text-stone-500">{{ 'Their family ID is given once they are linked to a parent or partner in the family.' | t }}</p>
        }
      </header>

      @if (error(); as e) {
        @if (!e.details.length || !hasFieldErrors()) { <fh-alert class="mb-6">{{ e.message }}</fh-alert> }
      }

      <form (submit)="$event.preventDefault(); save(f)" class="max-w-3xl space-y-6" novalidate>
        @if (relative()) {
          <section class="card grid gap-4 p-6 sm:grid-cols-2" [formGroup]="linkForm" [attr.aria-label]="'Relationship' | t">
            <div>
              <label class="label" for="link-subtype">{{ 'Relationship type' | t }}</label>
              <select id="link-subtype" class="input" formControlName="subtype">
                @for (s of linkSubtypes(); track s.value) { <option [value]="s.value">{{ s.label | t }}</option> }
              </select>
            </div>
            <div>
              <label class="label" for="link-ver">{{ 'Certainty' | t }}</label>
              <select id="link-ver" class="input" formControlName="verification">
                <option value="verified">{{ 'Verified' | t }}</option>
                <option value="unverified">{{ 'Not yet verified' | t }}</option>
                <option value="disputed">{{ 'Disputed' | t }}</option>
              </select>
            </div>
          </section>
        }
        @if (canPhoto()) {
          <div class="card p-6">
            <fh-profile-photo-field [name]="existing()?.displayName ?? ''" [current]="existing()?.photoUrl ?? null" [review]="false" [(value)]="photo" />
          </div>
        }
        <div class="card p-6">
          <fh-member-fields [form]="f" [error]="error()" [errorPrefix]="errorPrefix()" />
        </div>
        <div class="flex gap-3">
          <button type="submit" class="btn-primary" [disabled]="busy()">{{ busy() ? ('Saving…' | t) : existing() ? ('Save changes' | t) : ('Add person' | t) }}</button>
          <a [routerLink]="id() ? ['/members', id()] : relative() ? ['/members', relative()!.id] : ['/members']" class="btn-secondary">{{ 'Cancel' | t }}</a>
        </div>
      </form>
    } @else {
      <fh-spinner [showLabel]="true" />
    }
  `,
})
export class MemberEditPage {
  /** Route parameter when editing. */
  readonly id = input<string>();
  /** Query parameters when adding a relative from a profile. */
  readonly childOf = input<string>();
  readonly parentOf = input<string>();
  readonly partnerOf = input<string>();

  protected readonly context = inject(FamilyContextStore);
  private readonly membersApi = inject(MembersApi);
  private readonly archive = inject(ArchiveApi);
  private readonly router = inject(Router);

  protected readonly form = signal<MemberForm | null>(null);
  protected readonly existing = signal<MemberView | null>(null);
  protected readonly relative = signal<MemberView | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly loadError = signal<string | null>(null);
  /** A new cropped photo, `null` to remove the current one, `undefined` when unchanged. */
  protected readonly photo = signal<File | null | undefined>(undefined);
  protected readonly canPhoto = computed(() => this.context.can('media.upload'));

  protected readonly heading = computed(() => {
    const m = this.existing();
    return m ? t('Edit {name}', { name: m.displayName }) : t('Add a person');
  });
  /** Server field paths: new people are nested under "person". */
  protected readonly errorPrefix = computed(() => (this.id() ? '' : 'person.'));

  protected readonly relation = computed<Relation | null>(() => (this.childOf() ? 'childOf' : this.parentOf() ? 'parentOf' : this.partnerOf() ? 'partnerOf' : null));
  protected readonly relationText = computed(() =>
    t(
      {
        childOf: mark('Will be added as a child of'),
        parentOf: mark('Will be added as a parent of'),
        partnerOf: mark('Will be added as the husband or wife of'),
      }[this.relation() ?? 'childOf'],
    ),
  );
  protected readonly linkSubtypes = computed(() =>
    this.relation() === 'partnerOf'
      ? PARTNERSHIP_SUBTYPES.map((s) => ({ value: s, label: PARTNERSHIP_SUBTYPE_LABELS[s] }))
      : PARENT_CHILD_SUBTYPES.map((s) => ({ value: s, label: PARENT_CHILD_SUBTYPE_LABELS[s] })),
  );
  protected readonly linkForm = inject(NonNullableFormBuilder).group({ subtype: ['biological'], verification: ['verified' as VerificationState] });

  constructor() {
    effect(() => {
      const family = this.context.active();
      const id = this.id();
      const relativeId = this.childOf() ?? this.parentOf() ?? this.partnerOf();
      if (!family) return;
      untracked(() => void this.init(family.id, id, relativeId));
    });
  }

  private async init(familyId: string, id: string | undefined, relativeId: string | undefined): Promise<void> {
    try {
      if (id) {
        const m = await this.membersApi.get(familyId, id);
        if (!m.viewerCan.update) {
          this.loadError.set(t('Only the family’s administrators can edit people.'));
          return;
        }
        this.existing.set(m);
        this.form.set(memberForm(m));
      } else {
        if (!this.context.can('member.create')) {
          this.loadError.set(t('Only the family’s administrators can add people.'));
          return;
        }
        this.form.set(memberForm());
        if (relativeId) {
          this.relative.set(await this.membersApi.get(familyId, relativeId));
          if (this.relation() === 'partnerOf') this.linkForm.controls.subtype.setValue('marriage');
        }
      }
    } catch (err) {
      this.loadError.set(ApiError.from(err).message);
    }
  }

  protected hasFieldErrors(): boolean {
    return (this.error()?.details ?? []).some((d) => d.path && !d.path.startsWith('links'));
  }

  protected async save(f: MemberForm): Promise<void> {
    if (f.invalid) {
      f.markAllAsTouched();
      return;
    }
    const family = this.context.active()!;
    this.busy.set(true);
    this.error.set(null);
    try {
      const existing = this.existing();
      if (existing) {
        const removePhoto = this.photo() === null ? { profilePhotoMediaId: null } : {};
        await this.membersApi.update(family.id, existing.id, { ...memberInputFrom(f), ...removePhoto, version: existing.version ?? 0 });
        await this.finish(family.id, existing);
      } else {
        const body: CreateMemberRequest = { person: memberInputFrom(f) };
        const rel = this.relative();
        if (rel) {
          const { subtype, verification } = this.linkForm.getRawValue();
          const link = { memberId: rel.id, subtype: subtype as never, verification };
          body.links = this.relation() === 'childOf' ? { parents: [link] } : this.relation() === 'parentOf' ? { children: [link] } : { partners: [link] };
        }
        const created = await this.membersApi.create(family.id, body);
        void this.context.refresh();
        await this.finish(family.id, created);
      }
    } catch (err) {
      this.error.set(ApiError.from(err));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      this.busy.set(false);
    }
  }

  /** Uploads a newly chosen photo, then opens the person's page, saying how the photo went. */
  private async finish(familyId: string, person: { id: string; displayName: string }): Promise<void> {
    const notice = await this.savePhoto(familyId, person);
    await this.router.navigate(['/members', person.id], notice ? { state: { notice } } : {});
  }

  /** The person is saved by now, so a failed photo does not lose their details. */
  private async savePhoto(familyId: string, person: { id: string; displayName: string }): Promise<ProfileNotice | null> {
    const file = this.photo();
    if (!(file instanceof File)) return null;
    try {
      await uploadProfilePhoto(this.archive, familyId, person, file);
      return null;
    } catch (err) {
      return { tone: 'error', text: t('The details were saved, but the photo could not be added: {reason}', { reason: ApiError.from(err).message }) };
    }
  }
}
