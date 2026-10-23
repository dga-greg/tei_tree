import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TitleStrategy, type RouterStateSnapshot } from '@angular/router';
import { t } from './i18n';

/** Page titles in the chosen language: route titles are English texts marked with `mark()`. */
@Injectable({ providedIn: 'root' })
export class TranslatedTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const title = this.buildTitle(snapshot);
    if (title) this.title.setTitle(t(title));
  }
}
