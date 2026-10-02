// Builds the bilingual, branded HTML for the "your Intro session is ready" email — sent
// automatically (not researcher-triggered) once a real participant has completed BOTH REI-40 and
// Big Five, from whichever of this app's / bigfive-andrejkatin's own POST /api/result handler
// happens to win the sibling-completion race (see maybeSendIntroEmail in server.mjs). Same visual
// template as admin-dashboard-andrejkatin/server/email/consentLinkEmail.mjs (own duplicated copy
// per this project's established per-purpose duplication convention — these apps share no
// package). One link (a CODE_REVIEW magic link into code-review-ai, landing on the participant's
// Intro session — already resolves there automatically, no special-casing needed), no anti-priming
// numbering needed since this isn't a disguised psychometric instrument. No expiry note shown —
// the CODE_REVIEW token's TTL is 90 days, not the 24h instrument-link default, so a time-pressure
// line here would be misleading.

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const COPY = {
  sr: {
    subject: 'Sledeći korak u istraživanju',
    preheader: 'Kliknite na link ispod da započnete sledeći deo istraživanja.',
    heading: 'Hvala na popunjenim upitnicima',
    intro: 'Kliknite na dugme ispod da započnete uvodnu (Intro) sesiju istraživanja.',
    buttonText: 'Počni uvodnu sesiju',
    footer: 'Za sva pitanja, kontaktirajte nas na',
  },
  en: {
    subject: 'Next step in the study',
    preheader: 'Click the link below to start the next part of the study.',
    heading: 'Thank you for completing the questionnaires',
    intro: 'Click the button below to start the Intro session of the study.',
    buttonText: 'Start Intro session',
    footer: 'For any questions, contact us at',
  },
};

const DEFAULT_SENDER_NAME = 'BeyondAI Research Group';

/**
 * @param {'sr'|'en'} lang
 * @param {{ url: string, senderName?: string }} args
 * @returns {{ subject: string, html: string }}
 */
export function buildIntroTaskEmail(lang, { url, senderName }) {
  const t = COPY[lang] ?? COPY.sr;
  const brand = escapeHtml(senderName?.trim() || DEFAULT_SENDER_NAME);
  const html = `
<!doctype html>
<html lang="${lang}">
<body style="margin:0;padding:0;background:#f2f7f4;font-family:'Segoe UI',Arial,sans-serif;">
  <span style="display:none;font-size:1px;color:#f2f7f4;">${t.preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f7f4;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #c0dbc9;">
        <tr>
          <td style="background:#1a3a28;padding:24px 32px;">
            <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.02em;">${brand}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h1 style="margin:0 0 16px;font-size:22px;color:#1a2e1a;">${t.heading}</h1>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">${t.intro}</p>

            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
              <tr>
                <td style="padding:16px;background:#eaf2ec;border-radius:8px;" align="center">
                  <a href="${url}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:8px;">${t.buttonText}</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;">
            <p style="margin:0;font-size:12px;color:#6b7280;">${t.footer} <a href="mailto:beyondai.researchgroup@gmail.com" style="color:#16a34a;">beyondai.researchgroup@gmail.com</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  return { subject: t.subject, html };
}
