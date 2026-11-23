import nodemailer from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export function getSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig | null {
  const user = (env.SMTP_USER || '').trim();
  const pass = (env.SMTP_PASS || '').trim();
  if (!user || !pass) return null;

  const host = (env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = Number(env.SMTP_PORT || 465);
  const secure =
    env.SMTP_SECURE !== undefined
      ? env.SMTP_SECURE.trim().toLowerCase() !== 'false'
      : port === 465;
  const from = (env.SMTP_FROM || `AgencyOS by Kishan <${user}>`).trim();

  return { host, port, secure, user, pass, from };
}

export function isSmtpConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return getSmtpConfig(env) !== null;
}

export interface ResetEmailPayload {
  toEmail: string;
  resetCode: string;
  resetUrl?: string;
  expiresMinutes: number;
}

export async function sendSuperAdminResetEmail(
  payload: ResetEmailPayload,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const cfg = getSmtpConfig(env);
  if (!cfg) {
    throw new Error('SMTP_NOT_CONFIGURED');
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });

  const safeCode = payload.resetCode.replace(/[^A-Z0-9-]/gi, '');
  const resetLinkLine = payload.resetUrl
    ? `\nDirect reset link:\n${payload.resetUrl}\n`
    : '';

  const textBody = [
    'AgencyOS by Kishan — Super Admin Password Reset',
    '',
    'A password reset was requested for your Super Admin account.',
    '',
    `One-time Reset Code: ${safeCode}`,
    `Valid for: ${payload.expiresMinutes} minutes (single use)`,
    resetLinkLine,
    'If you did not request this password reset, you can safely ignore this email. Your existing password remains unchanged.',
  ].join('\n');

  const htmlLinkBlock = payload.resetUrl
    ? `<p style="margin:20px 0;"><a href="${payload.resetUrl.replace(/"/g, '&quot;')}" style="display:inline-block;padding:12px 22px;background:#C81E2B;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">Reset Super Admin Password</a></p>`
    : '';

  const htmlBody = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111113;background:#ffffff;border:1px solid #E5E7EB;border-radius:10px;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#B8860B;">AgencyOS by Kishan · Security Notice</p>
      <h2 style="margin:0 0 12px;font-size:20px;color:#111113;">Super Admin Password Reset</h2>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#3F3F46;">
        Use the one-time verification code below to set or reset your Super Admin password. This code expires in <strong>${payload.expiresMinutes} minutes</strong> and works once.
      </p>
      <div style="padding:14px 18px;background:#FAF7F2;border:1px solid #E2B340;border-radius:8px;text-align:center;margin:16px 0;">
        <span style="font-family:monospace;font-size:24px;font-weight:700;letter-spacing:4px;color:#C81E2B;">${safeCode}</span>
      </div>
      ${htmlLinkBlock}
      <p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#71717A;">
        If you did not request this reset, you can safely ignore this email. No changes have been made to your account.
      </p>
    </div>
  `.trim();

  await transporter.sendMail({
    from: cfg.from,
    to: payload.toEmail,
    subject: 'AgencyOS — Super Admin Password Reset Code',
    text: textBody,
    html: htmlBody,
  });
}
