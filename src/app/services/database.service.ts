import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { BigFiveScores } from '../data/bigfive-items';

// Generous on purpose: the API runs on Render's free tier, which sleeps after ~15 min idle and
// needs 30-50 s to wake up — a 10 s limit made the first click on an emailed link fail.
const REQUEST_TIMEOUT_MS = 90_000;

export interface BigFiveResultDto {
  participantId: string;
  language: 'sr' | 'en';
  answers: Record<number, number>;
  // On a timer auto-submit (isTimedOut), any factor with even one unanswered item computes to
  // null rather than a mean from a smaller N — same "never fabricate a score" rule as REI-40's
  // identical change.
  scores: { [K in keyof BigFiveScores]: number | null };
  /** True when this submission was auto-sent because the per-research timer (Research.
   *  TimerBigFiveEnabled/Minutes) expired, not because the participant clicked Submit themselves. */
  isTimedOut?: boolean;
  /** The BIGFIVE magic-link token this participant resolved with — required for a real
   *  (non-test) participant, omitted for a test participant (see server.mjs's POST /api/result). */
  token?: string | null;
}

@Injectable({ providedIn: 'root' })
export class DatabaseService {
  private http = inject(HttpClient);

  /** Dev/testing-only path (the real entry point is the emailed magic link, see resolveLink). */
  async checkParticipantExists(
    participantId: string
  ): Promise<{ exists: boolean; timerEnabled: boolean; timerMinutes: number | null }> {
    const res = await firstValueFrom(
      this.http
        .get<{ exists: boolean; timerEnabled?: boolean; timerMinutes?: number | null }>(
          `/api/participant/${encodeURIComponent(participantId)}`
        )
        .pipe(timeout(REQUEST_TIMEOUT_MS))
    );
    if (typeof res?.exists !== 'boolean') {
      throw new Error('Unexpected participant check response');
    }
    return { exists: res.exists, timerEnabled: res.timerEnabled === true, timerMinutes: res.timerMinutes ?? null };
  }

  async saveResult(dto: BigFiveResultDto): Promise<void> {
    await firstValueFrom(
      this.http.post<void>('/api/result', dto).pipe(timeout(REQUEST_TIMEOUT_MS))
    );
  }

  async resolveLink(token: string): Promise<LinkResolveResult> {
    try {
      const res = await firstValueFrom(
        this.http
          .get<{ participantId: string; lang: 'sr' | 'en'; timerEnabled?: boolean; timerMinutes?: number | null }>(
            `/api/link/${encodeURIComponent(token)}`
          )
          .pipe(timeout(REQUEST_TIMEOUT_MS))
      );
      return {
        ok: true,
        participantId: res.participantId,
        lang: res.lang,
        timerEnabled: res.timerEnabled === true,
        timerMinutes: res.timerMinutes ?? null,
      };
    } catch (err: any) {
      const code = err?.error?.error;
      if (code === 'NOT_FOUND' || code === 'EXPIRED' || code === 'ALREADY_COMPLETED' || code === 'NOT_ACTIVE') {
        return { ok: false, error: code };
      }
      return { ok: false, error: 'SERVER_ERROR' };
    }
  }
}

export type LinkResolveResult =
  | { ok: true; participantId: string; lang: 'sr' | 'en'; timerEnabled: boolean; timerMinutes: number | null }
  | { ok: false; error: 'NOT_FOUND' | 'EXPIRED' | 'ALREADY_COMPLETED' | 'NOT_ACTIVE' | 'SERVER_ERROR' };
