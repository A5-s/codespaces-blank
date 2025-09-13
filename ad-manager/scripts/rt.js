import readline from "readline";
import { google } from "googleapis";

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env") });

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in your .env first.");
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, "urn:ietf:wg:oauth:2.0:oob");

const SCOPES = ["https://mail.google.com/"]; // Full Gmail
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

console.log("\nOpen this URL, authorize, then paste the code here:\n");
console.log(authUrl + "\n");

rl.question("Enter the code: ", async (code) => {
  try {
    const { tokens } = await oAuth2Client.getToken(code.trim());
    if (!tokens.refresh_token) {
      console.error("No refresh_token returned. In the consent screen, make sure you clicked 'Allow' and that 'prompt=consent' and 'access_type=offline' were used.");
      process.exit(1);
    }
    console.log("\nYour REFRESH TOKEN:\n" + tokens.refresh_token + "\n");
    console.log("Put this in your .env as GMAIL_REFRESH_TOKEN");
  } catch (e) {
    console.error("Failed to exchange code:", e?.response?.data || e.message || e);
  } finally {
    rl.close();
  }
});