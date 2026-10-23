import { Pipe, type PipeTransform } from '@angular/core';
import { t } from './i18n';

/** `{{ 'Save' | t }}`, `{{ 'Hello {name}' | t: { name } }}`. The language is fixed while the app runs. */
@Pipe({ name: 't' })
export class TranslatePipe implements PipeTransform {
  transform(key: string | null | undefined, params?: Record<string, unknown>): string {
    return key ? t(key, params) : '';
  }
}
