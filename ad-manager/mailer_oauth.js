// mailer_oauth.js
import nodemailer from "nodemailer";
import { google } from "googleapis";

const {
  GMAIL_USER,
  GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET,
  GMAIL_REFRESH_TOKEN,
} = process.env;

const oAuth2Client = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET);
oAuth2Client.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });

async function getTransport() {
  const { token: accessToken } = await oAuth2Client.getAccessToken();
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: GMAIL_USER,
      clientId: GMAIL_CLIENT_ID,
      clientSecret: GMAIL_CLIENT_SECRET,
      refreshToken: GMAIL_REFRESH_TOKEN,
      accessToken,
    },
  });
}

export async function sendMail({ to, subject, html, text }) {
  const transporter = await getTransport();
  return transporter.sendMail({
    from: `Ad Manager <${GMAIL_USER}>`,
    to,
    subject,
    text,
    html,
  });
}