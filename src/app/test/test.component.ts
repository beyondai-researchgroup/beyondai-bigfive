import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { StateService } from '../services/state.service';
import { DatabaseService, BigFiveResultDto } from '../services/database.service';
import { BIGFIVE_ITEMS, BIGFIVE_FACTOR_ORDER, BigFiveItem, BigFiveFactor, BigFiveScores, computeBigFiveScores } from '../data/bigfive-items';
import { TimerDisplayComponent } from '../shared/timer-display/timer-display.component';

interface Section {
  factor: BigFiveFactor;
  items: BigFiveItem[];
}

@Component({
  selector: 'app-test',
  standalone: true,
  imports: [TranslateModule, TimerDisplayComponent],
  templateUrl: './test.component.html',
  styleUrl: './test.component.scss',
})
export class TestComponent implements OnInit {
  private state = inject(StateService);
  private db = inject(DatabaseService);
  private router = inject(Router);

  readonly sections: Section[] = BIGFIVE_FACTOR_ORDER.map(factor => ({
    factor,
    items: BIGFIVE_ITEMS.filter(i => i.factor === factor),
  }));

  readonly totalItems = BIGFIVE_ITEMS.length;
  readonly answers = signal<Record<number, number>>({});
  readonly answeredCount = computed(() => Object.keys(this.answers()).length);
  readonly allAnswered = computed(() => this.answeredCount() === this.totalItems);
  readonly submitting = signal(false);
  readonly submitError = signal(false);

  // Per-app participant timer (2026-09-11) — read once at test-start, same pattern as
  // rei40-andrejkatin's identical addition.
  readonly timerEnabled = this.state.state()?.timerEnabled ?? false;
  readonly timerMinutes = this.state.state()?.timerMinutes ?? 0;

  ngOnInit(): void {
    if (!this.state.state()) {
      this.router.navigate(['/login']);
    }
  }

  setAnswer(itemId: number, value: number): void {
    this.answers.update(a => ({ ...a, [itemId]: value }));
  }

  async submit(): Promise<void> {
    if (!this.allAnswered() || this.submitting()) return;
    await this.doSubmit(false);
  }

  /** Fired by <app-timer-display> exactly once, on expiry — sends whatever's currently answered
   *  instead of the normal allAnswered()-gated path. Guarded by the same `submitting` signal, so
   *  a manual submit that's already in flight (or just completed) can't race with this. */
  async onTimerExpired(): Promise<void> {
    if (this.submitting()) return;
    await this.doSubmit(true);
  }

  private async doSubmit(isTimedOut: boolean): Promise<void> {
    const s = this.state.state();
    if (!s) {
      this.router.navigate(['/login']);
      return;
    }

    this.submitting.set(true);
    this.submitError.set(false);

    try {
      // On a timed-out submission, computeBigFiveScores already produces NaN for any factor with
      // even one missing item (its averaging naturally propagates a missing addend, all items
      // here are positively keyed — no reverse-scoring transform to worry about) —
      // sanitizeScores turns that into an honest `null` rather than sending NaN over the wire.
      const scores = computeBigFiveScores(this.answers());
      await this.db.saveResult({
        participantId: s.participantId,
        language: s.lang,
        answers: this.answers(),
        scores: this.sanitizeScores(scores),
        isTimedOut,
        token: s.linkToken ?? null,
      });
      this.state.clear();
      this.router.navigate(['/done']);
    } catch {
      this.submitError.set(true);
    } finally {
      this.submitting.set(false);
    }
  }

  private sanitizeScores(scores: BigFiveScores): BigFiveResultDto['scores'] {
    const out: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(scores)) {
      out[key] = typeof value === 'number' && Number.isFinite(value) ? value : null;
    }
    return out as BigFiveResultDto['scores'];
  }
}
