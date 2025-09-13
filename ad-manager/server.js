import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import pool from "./db.js";
import playerRouter from "./routes/player.js";

dotenv.config();

import authRouter from "./routes/auth.js";
import campaignsRouter from "./routes/campaigns.js";
import adminRouter from "./routes/admin.js";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/api/player", playerRouter);

app.get("/login.html", (req, res) => {
  const token = req.cookies?.session;
  if (token) {
    try {
      const user = jwt.verify(token, JWT_SECRET);
      const dest = user.role === "admin" ? "/admin" : "/business";
      return res.redirect(302, dest);
    } catch { /* fallthrough to show login */ }
  }
  return res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.use("/auth", authRouter);
app.use("/api/campaigns", campaignsRouter);
app.use("/api/admin", adminRouter);

app.get("/business", (req, res) => {
  const token = req.cookies?.session;
  if (!token) return res.redirect(302, "/login.html?err=invalid");
  try {
    const user = jwt.verify(token, JWT_SECRET);
    if (user.role !== "business") return res.redirect(302, "/login.html?err=invalid");
    return res.sendFile(path.join(__dirname, "public", "business", "index.html"));
  } catch {
    return res.redirect(302, "/login.html?err=invalid");
  }
});

app.get("/admin", (req, res) => {
  const token = req.cookies?.session;
  if (!token) return res.redirect(302, "/login.html?err=invalid");
  try {
    const user = jwt.verify(token, JWT_SECRET);
    if (user.role !== "admin") return res.redirect(302, "/login.html?err=invalid");
    return res.sendFile(path.join(__dirname, "public", "admin", "index.html"));
  } catch {
    return res.redirect(302, "/login.html?err=invalid");
  }
});

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, "public", "index.html")));

setInterval(async () => {
  try { await pool.query(`delete from campaigns where status='deleted' and deleted_at < now() - interval '7 days'`); }
  catch (e) { console.error("[cleanup]", e?.message || e); }
}, 12 * 60 * 60 * 1000);

app.get("/player", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "player", "index.html"));
});

app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));