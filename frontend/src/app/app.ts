import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { IdleTimeoutService } from './core/auth/idle-timeout.service';

@Component({
  selector: 'fh-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class App {
  constructor() {
    // Watches for inactivity while someone is signed in.
    inject(IdleTimeoutService);
  }
}
