import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const PROVIDER = process.env.EMAIL_PROVIDER || "smtp";
let transporter;

async function ensureTransport() {
  if (transporter) return transporter;

  if (PROVIDER === "gmail_oauth") {
    const { GMAIL_USER, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
    if (!GMAIL_USER || !GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
      throw new Error("Missing Gmail OAuth envs");
    }
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: GMAIL_USER,
        clientId: GMAIL_CLIENT_ID,
        clientSecret: GMAIL_CLIENT_SECRET,
        refreshToken: GMAIL_REFRESH_TOKEN,
      },
    });
  } else {
    const { EMAIL_HOST, EMAIL_PORT, EMAIL_SECURE, EMAIL_USER, EMAIL_PASS } = process.env;
    transporter = nodemailer.createTransport({
      host: EMAIL_HOST,
      port: Number(EMAIL_PORT || 587),
      secure: String(EMAIL_SECURE || "false") === "true",
      auth: EMAIL_USER && EMAIL_PASS ? { user: EMAIL_USER, pass: EMAIL_PASS } : undefined,
    });
  }
  return transporter;
}

const FROM = process.env.FROM_EMAIL || "Ad Manager <no-reply@example.com>";

export async function sendVerificationEmail({ to, link }) {
  const t = await ensureTransport();
  await t.sendMail({
    from: FROM,
    to,
    subject: "Verify your email",
    html: `<p>Welcome! Click to verify:</p><p><a href="${link}">${link}</a></p>`,
  });
}

export async function sendCampaignDeletedEmail({ to, campaignTitle, recoverLink }) {
  const t = await ensureTransport();
  await t.sendMail({
    from: FROM,
    to,
    subject: `Ad removed: ${campaignTitle}`,
    html: `
      <p>Your ad <strong>${campaignTitle}</strong> was removed.</p>
      <p>If this wasn't you, you can recover it within 7 days:</p>
      <p><a href="${recoverLink}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#3a86ff;color:#fff;text-decoration:none;">Recover Ad</a></p>
      <p>Or open this link:<br>${recoverLink}</p>
    `,
  });
}