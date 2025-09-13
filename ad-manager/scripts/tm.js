import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const to = process.argv[2] || process.env.GMAIL_USER || process.env.EMAIL_USER;

function peek(v) { return v ? (v.length > 10 ? v.slice(0, 10) + "…" : v) : "(missing)"; }
function truthy(v) { return String(v).toLowerCase() === "true"; }

async function testSmtp() {
  const required = ["EMAIL_HOST", "EMAIL_PORT", "EMAIL_USER", "EMAIL_PASS"];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) throw new Error("Missing SMTP env: " + missing.join(", "));

  const host = process.env.EMAIL_HOST;
  const port = Number(process.env.EMAIL_PORT || 587);
  const secure = truthy(process.env.EMAIL_SECURE || "false");
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const from = process.env.FROM_EMAIL || user;

  console.log({ mode: "SMTP", host, port, secure, user, pass_len: (pass || "").length, from, to });

  const transporter = nodemailer.createTransport({
    host, port, secure,
    auth: { user, pass },
    logger: true,
    debug: true,
  });

  await transporter.verify();
  console.log("SMTP verify: OK");

  const info = await transporter.sendMail({
    from,
    to,
    subject: "test",
    text: "SMTP callback success.",
    html: "<p>OnlyTwentyOneCharacters</p>",
  });

  console.log("Sent:", info.messageId, info.response || "");
}

async function testGmailOAuth() {
  const required = ["GMAIL_USER", "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN"];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) throw new Error("Missing Gmail OAuth env: " + missing.join(", "));

  // Lazy import googleapis only if needed
  const { google } = await import("googleapis");

  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
  const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
  const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;

  console.log({
    mode: "GMAIL_OAUTH",
    user: GMAIL_USER,
    client_id: peek(GMAIL_CLIENT_ID),
    refresh_token: peek(GMAIL_REFRESH_TOKEN),
  });

  const oAuth2Client = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
  oAuth2Client.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });

  const { token: accessToken } = await oAuth2Client.getAccessToken();
  if (!accessToken) throw new Error("Could not obtain access token from refresh token");

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: GMAIL_USER,
      clientId: GMAIL_CLIENT_ID,
      clientSecret: GMAIL_CLIENT_SECRET,
      refreshToken: GMAIL_REFRESH_TOKEN,
      accessToken,
    },
    logger: true,
    debug: true,
  });

  const info = await transporter.sendMail({
    from: `Ad Manager <${GMAIL_USER}>`,
    to,
    subject: "SMTP Callback=success",
    text: "it works",
    html: "<p>zooweemama</p>",
  });

  console.log("Sent:", info.messageId);
}

(async () => {
  try {
    if (process.env.EMAIL_HOST) {
      await testSmtp();
    } else {
      await testGmailOAuth();
    }
  } catch (e) {
    console.error("SMTP/OAuth test failed:", e?.message || e);
    process.exit(1);
  }
})();