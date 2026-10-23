import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { RsvpAnswer, RsvpView } from '@fh/contracts';
import { ApiError } from '../../core/api/api-error';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { MessagingApi } from '../../core/messaging/messaging.api';
import { AlertComponent } from '../../shared/ui/alert.component';
import { SpinnerComponent } from '../../shared/ui/spinner.component';

/** The page behind a personal link in a ceremony announcement: no sign-in, one person's answer. */
@Component({
  selector: 'fh-rsvp-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AlertComponent, SpinnerComponent, TranslatePipe],
  template: `
    @if (view(); as v) {
      <p class="text-sm font-semibold uppercase tracking-widest text-gold-700 dark:text-gold-300">{{ v.familyName }}</p>
      <h1 class="mt-2 text-3xl font-semibold">{{ v.title }}</h1>
      <p class="mt-2 text-stone-600 dark:text-stone-300">{{ whenWhere(v) }}</p>
      <blockquote class="mt-4 whitespace-pre-line border-l-4 border-brand-300 pl-4 text-stone-700 dark:text-stone-300">{{ v.message }}</blockquote>

      @if (error(); as e) { <fh-alert class="mt-6 block">{{ e }}</fh-alert> }

      @if (!v.closed) {
        <h2 class="mt-8 text-lg font-semibold">{{ v.firstName ? ('{name}, are you coming?' | t: { name: v.firstName }) : ('Are you coming?' | t) }}</h2>
        <div class="mt-3 grid gap-2 sm:grid-cols-2">
          <button type="button" [class]="v.answer === 'yes' ? 'btn-primary' : 'btn-secondary'" [attr.aria-pressed]="v.answer === 'yes'" (click)="reply('yes')" [disabled]="busy()">{{ 'Yes, I am coming' | t }}</button>
          <button type="button" [class]="v.answer === 'no' ? 'btn-primary' : 'btn-secondary'" [attr.aria-pressed]="v.answer === 'no'" (click)="reply('no')" [disabled]="busy()">{{ 'I can’t make it' | t }}</button>
        </div>
        @if (v.answer) {
          <p class="mt-3 text-sm text-brand-800 dark:text-brand-200" role="status">{{ v.answer === 'yes' ? ('Thank you. The family knows you are coming.' | t) : ('Thank you for letting the family know.' | t) }}</p>
        }
      } @else if (v.answer) {
        <p class="mt-6 text-sm">{{ v.answer === 'yes' ? ('You said you were coming.' | t) : ('You said you could not come.' | t) }}</p>
      }

      <div class="mt-10 border-t border-stone-200 pt-4 text-sm text-stone-500 dark:border-stone-800">
        @if (v.optedOut) {
          <p>{{ 'You will not get SMS or WhatsApp messages from this family.' | t }}</p>
          <button type="button" class="mt-1 font-medium text-brand-700 hover:underline dark:text-brand-300" (click)="reply('start')" [disabled]="busy()">{{ 'Get messages again' | t }}</button>
        } @else {
          <button type="button" class="font-medium text-stone-600 hover:underline dark:text-stone-300" (click)="reply('stop')" [disabled]="busy()">{{ 'Stop SMS and WhatsApp messages from this family' | t }}</button>
        }
      </div>
    } @else if (error(); as e) {
      <h1 class="text-3xl font-semibold">{{ 'Family announcement' | t }}</h1>
      <fh-alert class="mt-6 block">{{ e }}</fh-alert>
    } @else {
      <fh-spinner [showLabel]="true" />
    }
  `,
})
export class RsvpPage {
  private readonly api = inject(MessagingApi);
  private readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';
  protected readonly view = signal<RsvpView | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    this.api.rsvp(this.token).then(
      (v) => this.view.set(v),
      (err: unknown) => this.error.set(ApiError.from(err).message),
    );
  }

  protected whenWhere(v: RsvpView): string {
    return [v.date, v.place].filter((x) => !!x).join(' · ');
  }

  protected async reply(answer: RsvpAnswer): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.view.set(await this.api.answer(this.token, answer));
    } catch (err) {
      this.error.set(ApiError.from(err).message);
    } finally {
      this.busy.set(false);
    }
  }
}
