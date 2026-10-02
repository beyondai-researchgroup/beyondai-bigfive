import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { StateService } from '../services/state.service';
import { DatabaseService } from '../services/database.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private state = inject(StateService);
  private router = inject(Router);
  private db = inject(DatabaseService);
  private translate = inject(TranslateService);

  readonly isChecking = signal(false);
  readonly participantNotFound = signal(false);
  readonly checkFailed = signal(false);
  /** The dev-login form is test-participants-only now — a real participant typing their id sees
   *  this instead of a generic error, telling them to use their emailed link instead. */
  readonly personalLinkRequired = signal(false);

  // Language is chosen here once, before/at login, and locked afterward — the header's language
  // toggle is commented out for exactly this reason. Mirrors global-header.component.ts's setLang.
  readonly currentLang = signal(this.translate.currentLang || 'sr');

  setLang(lang: string): void {
    this.translate.use(lang);
    this.currentLang.set(lang);
    try { localStorage.setItem('bigfive-lang', lang); } catch { /* ignore */ }
  }

  form = this.fb.group({
    participantId: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(50)]],
  });

  onParticipantIdInput(): void {
    this.participantNotFound.set(false);
    this.checkFailed.set(false);
    this.personalLinkRequired.set(false);
  }

  async submit(): Promise<void> {
    if (this.form.invalid || this.isChecking()) return;

    const participantId = this.form.value.participantId!.trim();

    this.participantNotFound.set(false);
    this.checkFailed.set(false);
    this.personalLinkRequired.set(false);
    this.isChecking.set(true);

    let timerEnabled = false;
    let timerMinutes: number | null = null;
    try {
      const result = await this.db.checkParticipantExists(participantId);
      if (!result.exists) {
        this.participantNotFound.set(true);
        this.isChecking.set(false);
        return;
      }
      timerEnabled = result.timerEnabled;
      timerMinutes = result.timerMinutes;
    } catch (err: any) {
      if (err?.status === 403 && err?.error?.error === 'PERSONAL_LINK_REQUIRED') {
        this.personalLinkRequired.set(true);
      } else {
        this.checkFailed.set(true);
      }
      this.isChecking.set(false);
      return;
    }

    this.isChecking.set(false);
    this.state.setState({
      participantId,
      lang: (this.translate.currentLang as 'sr' | 'en') || 'sr',
      timerEnabled,
      timerMinutes,
    });
    this.router.navigate(['/test']);
  }
}
