import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, computed, signal } from '@angular/core';

/**
 * Per-app participant timer (2026-09-11) — a simple mm:ss countdown starting from `minutes`
 * (set once at test-start, never restarted). Emits `expired` exactly once when it reaches zero;
 * the host component decides what "expired" means (here: force-submit whatever's answered so
 * far) — this component only counts down and announces, it never touches submission logic
 * itself. Purely visual/informational until expiry per the confirmed design (no lock-out, no
 * warning-only mode — auto-submit on expiry is the host's job).
 */
@Component({
  selector: 'app-timer-display',
  standalone: true,
  template: `
    <div class="timer-display" [class.timer-display--warning]="remainingSeconds() <= 60">
      {{ formatted() }}
    </div>
  `,
  styles: [
    `
      .timer-display {
        display: inline-flex;
        align-items: center;
        padding: 6px 14px;
        border-radius: var(--radius-input, 8px);
        background: var(--color-surface-alt, #f2f2f2);
        border: 1px solid var(--color-border, #ddd);
        font-variant-numeric: tabular-nums;
        font-weight: 600;
        font-size: 14px;
      }
      .timer-display--warning {
        color: var(--color-error, #c0392b);
        border-color: var(--color-error, #c0392b);
      }
    `,
  ],
})
export class TimerDisplayComponent implements OnInit, OnDestroy {
  @Input({ required: true }) minutes!: number;
  @Output() expired = new EventEmitter<void>();

  readonly remainingSeconds = signal(0);
  readonly formatted = computed(() => {
    const s = this.remainingSeconds();
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  });

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private hasExpired = false;

  ngOnInit(): void {
    this.remainingSeconds.set(Math.max(0, Math.round(this.minutes * 60)));
    this.intervalId = setInterval(() => this.tick(), 1000);
  }

  private tick(): void {
    const next = this.remainingSeconds() - 1;
    if (next <= 0) {
      this.remainingSeconds.set(0);
      this.stopInterval();
      if (!this.hasExpired) {
        this.hasExpired = true;
        this.expired.emit();
      }
      return;
    }
    this.remainingSeconds.set(next);
  }

  private stopInterval(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  ngOnDestroy(): void {
    this.stopInterval();
  }
}
