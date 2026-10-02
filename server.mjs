// Minimal local API server for the Big Five app: participant lookup + result writes
// against the shared Neon Postgres database. Run with `node --env-file=.env server.mjs`.
// Mirrors the pattern used by the NASA-TLX app's api/_lib/db.ts + server.ts, simplified
// (no SSR — this app is served separately via `ng serve` during local development).

import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { neon } from '@neondatabase/serverless';
import { createLocalSql } from './server/local-db.mjs';
import { sendMail } from './server/email/mailer.mjs';
import { buildIntroTaskEmail } from './server/email/introTaskEmail.mjs';

const PORT = process.env.PORT || 4311;
const ITEM_COUNT = 29;

// Dual-mode (2026-09-08, extended platform-wide) — DB_MODE=local (.env.local,
// npm run serve:api:local) swaps in a local Postgres client; see local-db.mjs's header comment.
// npm run serve:api:neon (.env) always talks to the real Neon project unchanged.
let dbClient;
function getDb() {
  if (!dbClient) {
    if (process.env.DB_MODE === 'local') {
      const url = process.env.LOCAL_DATABASE_URL;
      if (!url) throw new Error('LOCAL_DATABASE_URL environment variable is not set (DB_MODE=local)');
      dbClient = createLocalSql(url);
      console.log('[db] developer mode: local Postgres');
    } else {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error('DATABASE_URL environment variable is not set');
      dbClient = neon(url);
    }
  }
  return dbClient;
}

function isNonEmptyString(v, max) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}

function isScoreNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 5;
}

function validatePayload(body) {
  if (typeof body !== 'object' || body === null) return 'body must be an object';
  if (!isNonEmptyString(body.participantId, 50)) return 'participantId invalid';
  if (body.language !== 'sr' && body.language !== 'en') return 'language must be "sr" or "en"';

  // Timer auto-submit (2026-09-11) — same relaxation as rei40-andrejkatin's identical change: a
  // timed-out submission may have unanswered items/incomplete factor scores; anything present
  // still has to be valid.
  const isTimedOut = body.isTimedOut === true;

  const answers = body.answers;
  if (typeof answers !== 'object' || answers === null) return 'answers must be an object';
  for (let i = 1; i <= ITEM_COUNT; i++) {
    const v = answers[i] ?? answers[String(i)];
    if (v === undefined || v === null) {
      if (!isTimedOut) return `answers[${i}] must be an integer 1-5`;
      continue;
    }
    if (!Number.isInteger(v) || v < 1 || v > 5) return `answers[${i}] must be an integer 1-5`;
  }

  const scores = body.scores;
  if (typeof scores !== 'object' || scores === null) return 'scores must be an object';
  for (const key of ['O', 'C', 'E', 'A', 'N']) {
    if (isTimedOut && (scores[key] === null || scores[key] === undefined)) continue;
    if (!isScoreNumber(scores[key])) return `scores.${key} must be a number 1-5`;
  }

  return null;
}

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(express.json());

app.get('/api/participant/:id', async (req, res) => {
  const id = req.params.id;
  if (!isNonEmptyString(id, 50)) {
    res.status(400).json({ error: 'Invalid participant id' });
    return;
  }
  try {
    const sql = getDb();
    // LEFT JOIN (not inner) — same "legacy participant with no ResearchId" tolerance as this
    // file's own /api/link/:token route's COALESCE(...,TRUE) convention.
    const rows = await sql`
      SELECT p."ParticipantId", p."IsTestParticipant", COALESCE(r."TimerBigFiveEnabled", FALSE) AS "TimerBigFiveEnabled", r."TimerBigFiveMinutes"
      FROM "Participant" p
      LEFT JOIN "Research" r ON r."Id" = p."ResearchId"
      WHERE p."ParticipantId" = ${id}
    `;
    // 2026-09-09 fix — same ParticipantId-collision fix as rei40-andrejkatin's identical route
    // (dev-login only; the real entry point is /link/:token, unaffected).
    if (rows.length > 1) {
      res.status(409).json({ error: 'AMBIGUOUS_PARTICIPANT_ID' });
      return;
    }
    if (!rows.length) {
      res.json({ exists: false, timerEnabled: false, timerMinutes: null });
      return;
    }
    // The dev-login form (/login) is test-participants-only now — every real participant arrives
    // exclusively via their emailed magic link (/api/link/:token above), which never hits this
    // check since it's already proof of authorization on its own.
    if (!rows[0].IsTestParticipant) {
      res.status(403).json({ error: 'PERSONAL_LINK_REQUIRED' });
      return;
    }
    res.json({
      exists: true,
      timerEnabled: rows[0].TimerBigFiveEnabled === true,
      timerMinutes: rows[0].TimerBigFiveEnabled ? rows[0].TimerBigFiveMinutes : null,
      isTestParticipant: true,
    });
  } catch (err) {
    console.error('[DB] participant check error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Magic-link resolution (Phase C of the consent/token project — see beyondai's CLAUDE.md):
// participants reach this app exclusively via an emailed /link/:token URL now, issued by the
// Consent app. Resolves against SurveyAccessToken (SurveyType='BIGFIVE') + BigFiveResult as the
// completion signal, same as the plan's design — no separate "consumed" flag on the token row.
app.get('/api/link/:token', async (req, res) => {
  const token = req.params.token;
  if (!isNonEmptyString(token, 64)) {
    res.status(400).json({ error: 'Invalid token' });
    return;
  }
  try {
    const sql = getDb();
    // Joins on ParticipantGuid, not the bare ParticipantId — see rei40-andrejkatin's server.mjs's
    // identical fix for the full rationale (ParticipantId is scoped per research now, not
    // globally unique; the Token itself is what already uniquely resolves the participant).
    const rows = await sql`
      SELECT sat."ParticipantId", sat."ParticipantGuid", sat."ExpiresAt", p."Language",
             COALESCE(r."ConsentPortalActive", TRUE) AS "ConsentPortalActive",
             COALESCE(r."TimerBigFiveEnabled", FALSE) AS "TimerBigFiveEnabled", r."TimerBigFiveMinutes"
      FROM "SurveyAccessToken" sat
      JOIN "Participant" p ON p."Guid" = sat."ParticipantGuid"
      LEFT JOIN "Research" r ON r."Id" = p."ResearchId"
      WHERE sat."Token" = ${token} AND sat."SurveyType" = 'BIGFIVE'
      LIMIT 1
    `;
    if (!rows.length) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const row = rows[0];
    if (new Date(row.ExpiresAt) < new Date()) {
      res.status(410).json({ error: 'EXPIRED' });
      return;
    }
    // 2026-09-09 master pause switch — same Research.ConsentPortalActive column the Consent
    // app's slug-link Activate/Deactivate toggle writes. COALESCE(...,TRUE) so a legacy
    // participant with no ResearchId (pre-Phase-A/B row) is never blocked — matches this
    // codebase's established fallback convention for that case.
    if (!row.ConsentPortalActive) {
      res.status(403).json({ error: 'NOT_ACTIVE' });
      return;
    }
    const existing = await sql`SELECT 1 FROM "BigFiveResult" WHERE "ParticipantGuid" = ${row.ParticipantGuid} LIMIT 1`;
    if (existing.length) {
      res.status(409).json({ error: 'ALREADY_COMPLETED' });
      return;
    }
    res.json({
      participantId: row.ParticipantId,
      lang: row.Language ?? 'sr',
      timerEnabled: row.TimerBigFiveEnabled === true,
      timerMinutes: row.TimerBigFiveEnabled ? row.TimerBigFiveMinutes : null,
    });
  } catch (err) {
    console.error('[DB] link resolve error:', err);
    res.status(500).json({ error: 'SERVER_ERROR' });
  }
});

const CODE_REVIEW_APP_URL = process.env.CODE_REVIEW_APP_URL || 'http://localhost:4202';
// Same lifetime as admin-dashboard-andrejkatin's own CODE_REVIEW_TOKEN_TTL_MS — effectively
// permanent (2026-10-02 follow-up, was 90 days), meant to be reused for the participant's whole
// study run (Intro, both experimental sessions, every NASA-TLX handoff round-trip), not a
// one-shot 7-day instrument link.
const CODE_REVIEW_TOKEN_TTL_MS = 100 * 365 * 24 * 60 * 60 * 1000;

/**
 * Fires once, automatically, the moment a real (non-test) participant has completed BOTH REI-40
 * and Big Five — called from this app's own POST /api/result AND from rei40-andrejkatin's own
 * identical copy of this function, since either submission could be the one that completes the
 * pair. See rei40-andrejkatin/server.mjs's copy of this same function for the full doc comment
 * (race-safety via the atomic IntroEmailSentAt claim, etc.) — kept byte-for-byte identical here.
 */
async function maybeSendIntroEmail(sql, participantGuid) {
  const rows = await sql`
    SELECT p."Email", p."Language", r."TaskType", r."EmailSenderName", r."StudyDisplayName", r."Name" AS "ResearchName"
    FROM "Participant" p JOIN "Research" r ON r."Id" = p."ResearchId"
    WHERE p."Guid" = ${participantGuid}
  `;
  const p = rows[0];
  if (!p || p.TaskType !== 'PR_REVIEW') return;

  const rei40Done = await sql`SELECT 1 FROM "Rei40Result" WHERE "ParticipantGuid" = ${participantGuid} LIMIT 1`;
  if (!rei40Done.length) return;
  const bigfiveDone = await sql`SELECT 1 FROM "BigFiveResult" WHERE "ParticipantGuid" = ${participantGuid} LIMIT 1`;
  if (!bigfiveDone.length) return;

  const claim = await sql`
    UPDATE "Participant" SET "IntroEmailSentAt" = NOW()
    WHERE "Guid" = ${participantGuid} AND "IntroEmailSentAt" IS NULL
    RETURNING "ParticipantId"
  `;
  if (!claim.length) return;
  if (!p.Email) return;

  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + CODE_REVIEW_TOKEN_TTL_MS).toISOString();
  await sql`
    INSERT INTO "SurveyAccessToken" ("ParticipantId", "ParticipantGuid", "SurveyType", "Token", "ExpiresAt")
    VALUES (${claim[0].ParticipantId}, ${participantGuid}, 'CODE_REVIEW', ${token}, ${expiresAt})
    ON CONFLICT ("ParticipantGuid", "SurveyType") DO UPDATE SET
      "Token" = EXCLUDED."Token", "ExpiresAt" = EXCLUDED."ExpiresAt", "CreatedAt" = NOW()
  `;

  const url = `${CODE_REVIEW_APP_URL}/?link=${token}`;
  const senderName = p.EmailSenderName ?? p.StudyDisplayName ?? p.ResearchName ?? undefined;
  const { subject, html } = buildIntroTaskEmail(p.Language ?? 'sr', { url, senderName });
  await sendMail({ to: p.Email, subject, html, fromName: senderName });
}

app.post('/api/result', async (req, res) => {
  const validationError = validatePayload(req.body);
  if (validationError) {
    res.status(400).json({ error: `Invalid payload: ${validationError}` });
    return;
  }
  try {
    const sql = getDb();
    const b = req.body;
    const answersJson = {};
    for (let i = 1; i <= ITEM_COUNT; i++) {
      answersJson[i] = b.answers[i] ?? b.answers[String(i)];
    }

    // Every submission needs to know whether this is a repeatable test participant (upsert, no
    // token needed, no completion guard) or a real one (token required, one-shot) — see
    // rei40-andrejkatin's identical /api/result handler for the full rationale.
    const participantRows = await sql`SELECT "Guid", "IsTestParticipant" FROM "Participant" WHERE "ParticipantId" = ${b.participantId}`;
    if (participantRows.length !== 1) {
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }
    const isTestParticipant = participantRows[0].IsTestParticipant === true;

    if (!isTestParticipant) {
      const tokenRows = !isNonEmptyString(b.token, 64)
        ? []
        : await sql`
            SELECT 1 FROM "SurveyAccessToken"
            WHERE "Token" = ${b.token} AND "SurveyType" = 'BIGFIVE' AND "ParticipantGuid" = ${participantRows[0].Guid} AND "ExpiresAt" > NOW()
          `;
      if (!tokenRows.length) {
        res.status(403).json({ error: 'PERSONAL_LINK_REQUIRED' });
        return;
      }

      // "No editing after submission" — previously this endpoint unconditionally upserted, so
      // the magic-link's own ALREADY_COMPLETED gate (GET /api/link/:token) was only a UI-reachability
      // check, not an independent guard on the write itself. Enforce it here directly now.
      const existing = await sql`SELECT 1 FROM "BigFiveResult" WHERE "ParticipantGuid" = ${participantRows[0].Guid} LIMIT 1`;
      if (existing.length) {
        res.status(409).json({ error: 'ALREADY_COMPLETED' });
        return;
      }

      await sql`
        INSERT INTO "BigFiveResult" (
          "ParticipantId", "Language", "Answers",
          "Openness", "Conscientiousness", "Extraversion", "Agreeableness", "Neuroticism", "IsTimedOut"
        ) VALUES (
          ${b.participantId}, ${b.language}, ${JSON.stringify(answersJson)},
          ${b.scores.O ?? null}, ${b.scores.C ?? null}, ${b.scores.E ?? null}, ${b.scores.A ?? null}, ${b.scores.N ?? null},
          ${b.isTimedOut === true}
        )
      `;
      res.status(201).json({ ok: true });
      maybeSendIntroEmail(sql, participantRows[0].Guid).catch((err) =>
        console.error('[bigfive] intro email trigger failed:', err)
      );
      return;
    }

    // Test participant — always upserts, only the latest submission is ever kept.
    await sql`
      INSERT INTO "BigFiveResult" (
        "ParticipantId", "Language", "Answers",
        "Openness", "Conscientiousness", "Extraversion", "Agreeableness", "Neuroticism", "IsTimedOut"
      ) VALUES (
        ${b.participantId}, ${b.language}, ${JSON.stringify(answersJson)},
        ${b.scores.O ?? null}, ${b.scores.C ?? null}, ${b.scores.E ?? null}, ${b.scores.A ?? null}, ${b.scores.N ?? null},
        ${b.isTimedOut === true}
      )
      ON CONFLICT ("ParticipantGuid") DO UPDATE SET
        "Language" = EXCLUDED."Language",
        "Answers" = EXCLUDED."Answers",
        "Openness" = EXCLUDED."Openness",
        "Conscientiousness" = EXCLUDED."Conscientiousness",
        "Extraversion" = EXCLUDED."Extraversion",
        "Agreeableness" = EXCLUDED."Agreeableness",
        "Neuroticism" = EXCLUDED."Neuroticism",
        "IsTimedOut" = EXCLUDED."IsTimedOut",
        "CompletedAt" = NOW()
    `;
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[DB] save result error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.listen(PORT, () => {
  console.log(`Big Five API server listening on http://localhost:${PORT}`);
});
