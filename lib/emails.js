'use strict';

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.EMAIL_FROM || 'Hackr <hola@hackr.app>';

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
              <h1 style="margin:0 0 12px;font-size:30px;font-weight:800;color:#f1f0ff;line-height:1.15;letter-spacing:-0.03em;">Estás dentro. 🎉</h1>
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
                      <tr><td style="padding:7px 0;font-size:14px;color:#c4c0dc;">🎯 &nbsp;Declarás tu objetivo al grupo antes de empezar</td></tr>
                      <tr><td style="padding:7px 0;font-size:14px;color:#c4c0dc;">⚡ &nbsp;Sprint de 2h20 con cámaras encendidas, sin distracciones</td></tr>
                      <tr><td style="padding:7px 0;font-size:14px;color:#c4c0dc;">🚀 &nbsp;Demo de 5 min: mostrás lo que hiciste. Sin excusas.</td></tr>
                      <tr><td style="padding:7px 0;font-size:14px;color:#c4c0dc;">🔁 &nbsp;Cada semana. Se convierte en hábito.</td></tr>
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
        <p style="margin:0;font-size:16px;font-weight:700;color:#a855f7;">🔔 Nuevo signup en Hackr</p>
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

// ── Send functions ───────────────────────────────────────────────────────────

async function sendConfirmation(email) {
  if (!process.env.RESEND_API_KEY) return null;
  try {
    return await resend.emails.send({
      from: FROM,
      to: email,
      subject: '¡Estás en la lista! Hackr te avisa cuando lancemos 🚀',
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
    return await resend.emails.send({
      from: FROM,
      to: process.env.ADMIN_EMAIL,
      subject: `🔔 Nuevo signup — ${email} (${total} en lista)`,
      html: adminNotificationHTML(email, total),
    });
  } catch (err) {
    console.error('[email] sendAdminNotification error:', err.message);
    return null;
  }
}

module.exports = { sendConfirmation, sendAdminNotification };
