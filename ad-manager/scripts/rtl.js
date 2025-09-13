import http from "http";
import open from "open";
import { google } from "googleapis";
import dotenv from "dotenv";
dotenv.config();

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env first.");
  process.exit(1);
}

const SCOPES = ["https://mail.google.com/"];
const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/oauth2callback`;

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

console.log("\nOpening browser for consent… If it doesn't open, visit:\n", authUrl, "\n");
try { await open(authUrl); } catch {}

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/oauth2callback")) return res.end("Wrong path");
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const code = url.searchParams.get("code");
  if (!code) return res.end("No code");

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    res.end("OK, you can close this tab.");
    server.close();
    if (!tokens.refresh_token) {
      console.error("No refresh_token returned. Revoke app access and ensure prompt=consent & access_type=offline.");
      process.exit(1);
    }
    console.log("\nYour GMAIL_REFRESH_TOKEN:\n" + tokens.refresh_token + "\n");
    console.log("Add it to .env as GMAIL_REFRESH_TOKEN");
  } catch (e) {
    console.error("Token exchange failed:", e?.response?.data || e.message);
    res.end("Error, check console.");
    server.close();
  }
});
server.listen(PORT, () => console.log(`Listening on ${REDIRECT_URI}`));