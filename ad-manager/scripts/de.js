import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.join(__dirname, "..", ".env");

console.log({ cwd: process.cwd(), envPath, exists: fs.existsSync(envPath) });

const res = dotenv.config({ path: envPath });
console.log("dotenv status:", res.error ? res.error.message : "OK");

// dump a few keys to verify load
const peek = (s) => (s ? s.slice(0, Math.min(10, s.length)) + "…" : "(missing)");
console.log({
  GMAIL_USER: process.env.GMAIL_USER || "(missing)",
  GMAIL_CLIENT_ID: peek(process.env.GMAIL_CLIENT_ID),
  GMAIL_CLIENT_SECRET: peek(process.env.GMAIL_CLIENT_SECRET),
  GMAIL_REFRESH_TOKEN: peek(process.env.GMAIL_REFRESH_TOKEN),
});