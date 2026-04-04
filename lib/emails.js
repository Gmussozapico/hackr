'use strict';

const { Resend } = require('resend');

const FROM = process.env.EMAIL_FROM || 'Hackr <hola@hackr.app>';

// Lazy init — avoids crash when RESEND_API_KEY is not set
let _resend = null;
function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

// ── Email templates ──────────────────────────────────────────────────────────

function confirmationHTML(email) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Estás en la lista — Hackr</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#0a0a0f;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" role="presentation" style="max-width:580px;width:100%;background:#12121a;border-radius:16px;border:1px solid rgba(124,58,237,0.25);overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 28px;border-bottom:1px solid rgba(124,58,237,0.18);">
              <p style="margin:0;font-family:'Courier New',monospace;font-size:22px;font-weight:700;color:#a855f7;letter-spacing:-0.5px;">hackr_</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h1 style="margin:0 0 12px;font-size:30px;font-weight:800;color:#f1f0ff;line-height:1.15;letter-spacing:-0.03em;">Estás dentro.</h1>
              <p style="margin:0 0 28px;font-size:16px;color:#a09db8;line-height:1.7;">
                Registramos <strong style="color:#f1f0ff;">${email}</strong> en el waitlist.<br />
                Te avisamos en cuanto abramos las primeras sesiones.
              </p>

              <!-- What to expect box -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#1a1a26;border-radius:12px;border:1px solid rgba(124,58,237,0.15);margin:0 0 32px;">
                <tr>
                  <td style="padding:24px 28px;">
                    <p style="margin:0 0 18px;font-family:'Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#a855f7;">Qué vas a vivir</p>
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr><td style="padding:7px 0;font-size:14px;color:#c4c0dc;">→ &nbsp;Declarás tu objetivo al grupo antes de empezar</td></tr>
                      <tr><td style="padding:7px 0;font-size:14px;color:#c4c0dc;">→ &nbsp;Sprint de 2h20 con cámaras encendidas, sin distracciones</td></tr>
                      <tr><td style="padding:7px 0;font-size:14px;color:#c4c0dc;">→ &nbsp;Demo de 5 min: mostrás lo que hiciste. Sin excusas.</td></tr>
                      <tr><td style="padding:7px 0;font-size:14px;color:#c4c0dc;">→ &nbsp;Cada semana. Se convierte en hábito.</td></tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 32px;font-size:15px;color:#a09db8;line-height:1.7;">
                Si conocés a alguien que procrastina con sus proyectos, mandales el link.<br />
                La comunidad la construimos entre todos.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="border-radius:10px;background:linear-gradient(135deg,#7c3aed,#f97316);padding:1px;">
                    <a href="https://hackr.app" target="_blank"
                       style="display:block;border-radius:9px;background:#12121a;padding:14px 32px;font-size:15px;font-weight:700;color:#f1f0ff;text-decoration:none;letter-spacing:-0.01em;">
                      Ver Hackr →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:22px 40px;border-top:1px solid rgba(124,58,237,0.12);">
              <p style="margin:0;font-size:12px;color:#3d3a52;line-height:1.6;">
                Construido por builders, para builders. · Santiago de Chile · 2026<br />
                Recibiste este email porque te anotaste en hackr.app.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function adminNotificationHTML(email, total) {
  const now = new Date().toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:32px 16px;background:#0a0a0f;font-family:'Courier New',monospace;">
  <table width="480" cellpadding="0" cellspacing="0" role="presentation"
         style="max-width:480px;background:#12121a;border-radius:12px;border:1px solid rgba(124,58,237,0.3);overflow:hidden;">
    <tr>
      <td style="padding:28px 32px;border-bottom:1px solid rgba(124,58,237,0.15);">
        <p style="margin:0;font-size:16px;font-weight:700;color:#a855f7;">Nuevo signup en Hackr</p>
      </td>
    </tr>
    <tr>
      <td style="padding:28px 32px;">
        <table width="100%" cellpadding="0" cellspacing="6" role="presentation">
          <tr>
            <td style="font-size:13px;color:#a09db8;padding:6px 0;"><strong style="color:#f1f0ff;">Email:</strong></td>
            <td style="font-size:13px;color:#f1f0ff;padding:6px 0;">${email}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#a09db8;padding:6px 0;"><strong style="color:#f1f0ff;">Hora:</strong></td>
            <td style="font-size:13px;color:#f1f0ff;padding:6px 0;">${now} CLT</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#a09db8;padding:6px 0;"><strong style="color:#f1f0ff;">Total waitlist:</strong></td>
            <td style="font-size:20px;font-weight:800;color:#a855f7;padding:6px 0;">${total}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function sessionConfirmationHTML(email, name, session) {
  const dateStr = new Date(session.session_date + 'T12:00:00').toLocaleDateString('es-CL', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'America/Santiago',
  });
  const greeting   = name ? `Hola ${name},` : 'Hola,';
  const isHackathon = session.type === 'hackathon';
  const tagLabel   = isHackathon ? 'Hackathon' : 'Sesión Semanal';
  const tagColor   = isHackathon ? '#f97316' : '#a855f7';
  const tagBg      = isHackathon ? 'rgba(249,115,22,0.12)' : 'rgba(124,58,237,0.14)';
  const tagBorder  = isHackathon ? 'rgba(249,115,22,0.3)'  : 'rgba(124,58,237,0.3)';
  const format     = Array.isArray(session.format) ? session.format : [];

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Tu lugar está reservado — Hackr</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#0a0a0f;padding:48px 16px;">
    <tr>
      <td align="center">
        <table width="580" cellpadding="0" cellspacing="0" role="presentation" style="max-width:580px;width:100%;background:#12121a;border-radius:16px;border:1px solid rgba(124,58,237,0.25);overflow:hidden;">

          <tr>
            <td style="padding:32px 40px 28px;border-bottom:1px solid rgba(124,58,237,0.18);">
              <p style="margin:0;font-family:'Courier New',monospace;font-size:22px;font-weight:700;color:#a855f7;letter-spacing:-0.5px;">hackr_</p>
            </td>
          </tr>

          <tr>
            <td style="padding:40px 40px 32px;">
              <h1 style="margin:0 0 8px;font-size:28px;font-weight:800;color:#f1f0ff;line-height:1.2;letter-spacing:-0.03em;">Tu lugar está reservado.</h1>
              <p style="margin:0 0 28px;font-size:15px;color:#a09db8;line-height:1.7;">${greeting} Confirmamos tu registro para la siguiente sesión.</p>

              <!-- Session detail -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#1a1a26;border-radius:12px;border:1px solid ${tagBorder};margin:0 0 24px;overflow:hidden;">
                <tr>
                  <td style="padding:24px 28px;border-left:3px solid ${tagColor};">
                    <p style="margin:0 0 8px;">
                      <span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:0.2rem 0.6rem;border-radius:100px;background:${tagBg};color:${tagColor};border:1px solid ${tagBorder};">${tagLabel}</span>
                    </p>
                    <p style="margin:4px 0 0;font-family:'Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#a09db8;">${session.num}</p>
                    <p style="margin:6px 0 4px;font-size:18px;font-weight:800;color:#f1f0ff;letter-spacing:-0.02em;">${session.title}</p>
                    <p style="margin:0;font-size:13px;color:#a09db8;">${dateStr} · ${session.start_time} – ${session.end_time} CLT</p>
                  </td>
                </tr>
              </table>

              ${format.length > 0 ? `
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#1a1a26;border-radius:12px;border:1px solid rgba(124,58,237,0.15);margin:0 0 24px;">
                <tr>
                  <td style="padding:20px 28px;">
                    <p style="margin:0 0 14px;font-family:'Courier New',monospace;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#a855f7;">Estructura de la sesión</p>
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      ${format.map(f => `<tr><td style="padding:5px 0;font-size:13px;color:#c4c0dc;">→ ${f}</td></tr>`).join('')}
                    </table>
                  </td>
                </tr>
              </table>
              ` : ''}

              <p style="margin:0 0 28px;font-size:14px;color:#a09db8;line-height:1.7;">
                El link de la videollamada te llegará por email el día de la sesión.<br />
                Llegá a tiempo — el check-in es parte de la experiencia.
              </p>

              <table cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="border-radius:10px;background:linear-gradient(135deg,#7c3aed,#f97316);padding:1px;">
                    <a href="https://hackr.app/#sessions" target="_blank"
                       style="display:block;border-radius:9px;background:#12121a;padding:14px 32px;font-size:15px;font-weight:700;color:#f1f0ff;text-decoration:none;letter-spacing:-0.01em;">
                      Ver todas las sesiones →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:22px 40px;border-top:1px solid rgba(124,58,237,0.12);">
              <p style="margin:0;font-size:12px;color:#3d3a52;line-height:1.6;">
                Construido por builders, para builders. · Santiago de Chile · 2026<br />
                Recibiste este email porque te registraste en hackr.app.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function sessionAdminNotificationHTML(email, name, session, total) {
  const now = new Date().toLocaleString('es-CL', {
    timeZone: 'America/Santiago', dateStyle: 'medium', timeStyle: 'short',
  });
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:32px 16px;background:#0a0a0f;font-family:'Courier New',monospace;">
  <table width="480" cellpadding="0" cellspacing="0" role="presentation"
         style="max-width:480px;background:#12121a;border-radius:12px;border:1px solid rgba(124,58,237,0.3);overflow:hidden;">
    <tr>
      <td style="padding:28px 32px;border-bottom:1px solid rgba(124,58,237,0.15);">
        <p style="margin:0;font-size:16px;font-weight:700;color:#a855f7;">Nueva inscripcion — ${session.num}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:28px 32px;">
        <table width="100%" cellpadding="0" cellspacing="6" role="presentation">
          <tr>
            <td style="font-size:13px;color:#a09db8;padding:6px 0;"><strong style="color:#f1f0ff;">Email:</strong></td>
            <td style="font-size:13px;color:#f1f0ff;padding:6px 0;">${email}</td>
          </tr>
          ${name ? `<tr>
            <td style="font-size:13px;color:#a09db8;padding:6px 0;"><strong style="color:#f1f0ff;">Nombre:</strong></td>
            <td style="font-size:13px;color:#f1f0ff;padding:6px 0;">${name}</td>
          </tr>` : ''}
          <tr>
            <td style="font-size:13px;color:#a09db8;padding:6px 0;"><strong style="color:#f1f0ff;">Sesion:</strong></td>
            <td style="font-size:13px;color:#f1f0ff;padding:6px 0;">${session.num} — ${session.title}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#a09db8;padding:6px 0;"><strong style="color:#f1f0ff;">Fecha sesion:</strong></td>
            <td style="font-size:13px;color:#f1f0ff;padding:6px 0;">${session.session_date}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#a09db8;padding:6px 0;"><strong style="color:#f1f0ff;">Registrado a las:</strong></td>
            <td style="font-size:13px;color:#f1f0ff;padding:6px 0;">${now} CLT</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:#a09db8;padding:6px 0;"><strong style="color:#f1f0ff;">Inscritos en sesion:</strong></td>
            <td style="font-size:20px;font-weight:800;color:#a855f7;padding:6px 0;">${total} / ${session.max_spots}</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Send functions ───────────────────────────────────────────────────────────

async function sendConfirmation(email) {
  if (!process.env.RESEND_API_KEY) return null;
  try {
    return await getResend().emails.send({
      from: FROM,
      to: email,
      subject: '¡Estás en la lista! Hackr te avisa cuando lancemos',
      html: confirmationHTML(email),
    });
  } catch (err) {
    console.error('[email] sendConfirmation error:', err.message);
    return null;
  }
}

async function sendAdminNotification(email, total) {
  if (!process.env.RESEND_API_KEY || !process.env.ADMIN_EMAIL) return null;
  try {
    return await getResend().emails.send({
      from: FROM,
      to: process.env.ADMIN_EMAIL,
      subject: `Nuevo signup — ${email} (${total} en lista)`,
      html: adminNotificationHTML(email, total),
    });
  } catch (err) {
    console.error('[email] sendAdminNotification error:', err.message);
    return null;
  }
}

async function sendSessionConfirmation(email, name, session) {
  if (!process.env.RESEND_API_KEY) return null;
  try {
    return await getResend().emails.send({
      from: FROM,
      to: email,
      subject: `Lugar reservado: ${session.num} — ${session.title}`,
      html: sessionConfirmationHTML(email, name, session),
    });
  } catch (err) {
    console.error('[email] sendSessionConfirmation error:', err.message);
    return null;
  }
}

async function sendSessionAdminNotification(email, name, session, total) {
  if (!process.env.RESEND_API_KEY || !process.env.ADMIN_EMAIL) return null;
  try {
    return await getResend().emails.send({
      from: FROM,
      to: process.env.ADMIN_EMAIL,
      subject: `Nueva inscripcion — ${email} en ${session.num} (${total}/${session.max_spots})`,
      html: sessionAdminNotificationHTML(email, name, session, total),
    });
  } catch (err) {
    console.error('[email] sendSessionAdminNotification error:', err.message);
    return null;
  }
}

module.exports = { sendConfirmation, sendAdminNotification, sendSessionConfirmation, sendSessionAdminNotification };
