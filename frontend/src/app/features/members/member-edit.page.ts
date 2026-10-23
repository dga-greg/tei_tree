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
import { CollaborationApi } from '../../core/collaboration/collaboration.api';
import { MembersApi } from '../../core/members/members.api';
import { AlertComponent } from '../../shared/ui/alert.component';
import { NoFamilyComponent } from '../../shared/ui/no-family.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';
import { changedFields, memberForm, memberInputFrom, type MemberForm } from './member-fields';
import { MemberFieldsComponent } from './member-fields.component';
import { uploadMode } from '../media/media.page';
import { ProfilePhotoFieldComponent } from './profile-photo-field.component';
import { uploadProfilePhoto } from './profile-photo';
import { mark, t } from '../../core/i18n/i18n';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

type Relation = 'childOf' | 'parentOf' | 'partnerOf';
/**
 * - `edit` / `create`: the viewer may change the record directly.
 * - `own`: the viewer's claimed profile; personal details save directly, genealogical facts are proposed.
 * - `propose` / `propose-create`: everything is submitted for review.
 */
/** Shown on the person's page after saving (router state). */
export interface ProfileNotice {
  tone: 'info' | 'error';
  text: string;
}

type Mode = 'create' | 'edit' | 'own' | 'propose' | 'propose-create';

/** Fields people may keep up to date on their own claimed profile (mirrors the server). */
const OWN_PROFILE_FIELDS = new Set(['profilePhotoMediaId', 'preferredName', 'biography', 'education', 'occupations', 'achievements', 'contact', 'nationality', 'hometown', 'privacy']);


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
        @if (relative(); as r) {
          <p class="mt-1 text-stone-600 dark:text-stone-400">{{ relationText() }} <strong>{{ r.displayName }}</strong>.</p>
        }
        @switch (mode()) {
          @case ('propose') {
            <fh-alert tone="info" class="mt-4 block max-w-4xl">{{ "Your changes are sent to the family's moderators as a suggestion. Nothing changes until one of them approves it." | t }}</fh-alert>
          }
          @case ('propose-create') {
            <fh-alert tone="info" class="mt-4 block max-w-4xl">{{ 'This person is added once a moderator approves your suggestion.' | t }}</fh-alert>
          }
          @case ('own') {
            <fh-alert tone="info" class="mt-4 block max-w-4xl">{{ 'This is your profile. Personal details (biography, work, education, contact, hometown, privacy) save straight away; changes to names, dates and life status are sent for review.' | t }}</fh-alert>
          }
        }
      </header>

      @if (error(); as e) {
        @if (!e.details.length || !hasFieldErrors()) { <fh-alert class="mb-6">{{ e.message }}</fh-alert> }
      }

      <form (submit)="$event.preventDefault(); save(f)" class="max-w-4xl space-y-6" novalidate>
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
        @if (photoAllowed()) {
          <div class="card p-6">
            <fh-profile-photo-field [name]="existing()?.displayName ?? ''" [current]="existing()?.photoUrl ?? null" [review]="uploads() === 'review'" [(value)]="photo" />
          </div>
        }
        <div class="card p-6">
          <fh-member-fields [form]="f" [error]="error()" [errorPrefix]="errorPrefix()" />
        </div>
        @if (mode() !== 'edit' && mode() !== 'create') {
          <div class="card p-6">
            <label class="label" for="proposal-note">{{ 'How do you know?' | t }} <span class="font-normal text-stone-500">{{ '(optional, helps the reviewer)' | t }}</span></label>
            <textarea id="proposal-note" class="input min-h-24" maxlength="2000" [value]="note()" (input)="note.set($any($event.target).value)"
                      [placeholder]="'A document, a family record, what a relative remembers…' | t"></textarea>
          </div>
        }
        @if (nothingChanged()) { <fh-alert tone="info">{{ 'You have not changed anything yet.' | t }}</fh-alert> }
        <div class="flex gap-3">
          <button type="submit" class="btn-primary" [disabled]="busy()">{{ busy() ? ('Saving…' | t) : submitLabel() }}</button>
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
  private readonly collaboration = inject(CollaborationApi);
  private readonly archive = inject(ArchiveApi);
  private readonly router = inject(Router);

  protected readonly form = signal<MemberForm | null>(null);
  protected readonly existing = signal<MemberView | null>(null);
  protected readonly relative = signal<MemberView | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<ApiError | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly note = signal('');
  protected readonly nothingChanged = signal(false);
  /** A new cropped photo, `null` to remove the current one, `undefined` when unchanged. */
  protected readonly photo = signal<File | null | undefined>(undefined);
  protected readonly uploads = computed(() => uploadMode(this.context));
  /** Suggestions go through review as a whole; photos are added from the profile or Photos & Documents instead. */
  protected readonly photoAllowed = computed(() => {
    const mode = this.mode();
    return (mode === 'create' || mode === 'edit' || mode === 'own') && this.uploads() !== null;
  });

  protected readonly mode = computed<Mode>(() => {
    const m = this.existing();
    if (this.id()) {
      if (!m) return 'edit';
      return m.viewerCan.update ? 'edit' : m.viewerCan.editOwn ? 'own' : 'propose';
    }
    const rel = this.relative();
    const direct = rel ? rel.viewerCan.manageRelationships : this.context.can('member.create');
    return direct ? 'create' : 'propose-create';
  });
  protected readonly heading = computed(() => {
    const name = this.existing()?.displayName ?? '';
    const mode = this.mode();
    if (mode === 'edit') return t('Edit {name}', { name });
    if (mode === 'propose') return t('Suggest a correction to {name}', { name });
    return t({ create: mark('Add a person'), 'propose-create': mark('Suggest a new relative'), own: mark('Edit your profile') }[mode]);
  });
  protected readonly submitLabel = computed(() => t({ create: mark('Add person'), 'propose-create': mark('Send suggestion'), edit: mark('Save changes'), own: mark('Save'), propose: mark('Send suggestion') }[this.mode()]));
  /** Server field paths: new people are nested under "person". */
  protected readonly errorPrefix = computed(() => (this.id() ? '' : 'person.'));

  protected readonly relation = computed<Relation | null>(() => (this.childOf() ? 'childOf' : this.parentOf() ? 'parentOf' : this.partnerOf() ? 'partnerOf' : null));
  protected readonly relationText = computed(() =>
    t(
      {
        childOf: mark('Will be added as a child of'),
        parentOf: mark('Will be added as a parent of'),
        partnerOf: mark('Will be added as a partner of'),
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
        if (!m.viewerCan.update && !m.viewerCan.editOwn && !m.viewerCan.propose) {
          this.loadError.set(t('You do not have permission to edit this profile.'));
          return;
        }
        this.existing.set(m);
        this.form.set(memberForm(m));
      } else {
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
    const note = this.note().trim() || undefined;
    this.busy.set(true);
    this.error.set(null);
    this.nothingChanged.set(false);
    try {
      const existing = this.existing();
      const mode = this.mode();
      if (existing && mode === 'edit') {
        const removePhoto = this.photo() === null ? { profilePhotoMediaId: null } : {};
        await this.membersApi.update(family.id, existing.id, { ...memberInputFrom(f, existing), ...removePhoto, version: existing.version ?? 0 });
        await this.finish(family.id, existing);
      } else if (existing) {
        const changes: Record<string, unknown> = changedFields(f, existing);
        if (this.photo() === null) changes['profilePhotoMediaId'] = null;
        const newPhoto = this.photo() instanceof File;
        const own = mode === 'own' ? Object.fromEntries(Object.entries(changes).filter(([k]) => OWN_PROFILE_FIELDS.has(k))) : {};
        const proposed = Object.fromEntries(Object.entries(changes).filter(([k]) => !(k in own)));
        if (!Object.keys(changes).length && !newPhoto) {
          this.nothingChanged.set(true);
          return;
        }
        if (Object.keys(own).length) {
          await this.membersApi.update(family.id, existing.id, { ...own, version: existing.version ?? 0 });
        }
        if (Object.keys(proposed).length) {
          const c = await this.collaboration.propose(family.id, { kind: 'member.update', targetId: existing.id, payload: proposed, note });
          await this.savePhoto(family.id, existing);
          await this.router.navigate(['/contributions'], { queryParams: { id: c.id } });
        } else {
          await this.finish(family.id, existing);
        }
      } else {
        const body: CreateMemberRequest = { person: memberInputFrom(f) };
        const rel = this.relative();
        if (rel) {
          const { subtype, verification } = this.linkForm.getRawValue();
          const link = { memberId: rel.id, subtype: subtype as never, verification };
          body.links = this.relation() === 'childOf' ? { parents: [link] } : this.relation() === 'parentOf' ? { children: [link] } : { partners: [link] };
        }
        if (mode === 'propose-create') {
          const c = await this.collaboration.propose(family.id, { kind: 'member.create', payload: body as unknown as Record<string, unknown>, note });
          await this.router.navigate(['/contributions'], { queryParams: { id: c.id } });
          return;
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
      const media = await uploadProfilePhoto(this.archive, familyId, person, file);
      return media.status === 'pending_approval' ? { tone: 'info', text: t('The photo was sent to a moderator. It appears once they approve it.') } : null;
    } catch (err) {
      return { tone: 'error', text: t('The details were saved, but the photo could not be added: {reason}', { reason: ApiError.from(err).message }) };
    }
  }
}
