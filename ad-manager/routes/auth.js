import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import pool from "../db.js";
import { sendVerificationEmail } from "../mailer.js";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

const devCookie = {
  httpOnly: true,
  secure: false,
  sameSite: "lax",
  path: "/",
  maxAge: 1000 * 60 * 60 * 12, // 12h
};

function baseUrlFrom(req) {
  const env = process.env.BASE_URL;
  if (env) return env.replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers.host;
  return `${proto}://${host}`;
}

async function findUserByEmail(email) {
  const row = await pool.query(
    "select id, email, company_name, password_hash, role, verified from users where email=$1",
    [String(email || "").toLowerCase()]
  );
  return row.rows[0] || null;
}

function signSession(user) {
  return jwt.sign(
    { id: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

async function createVerifyToken(user_id, ttlMinutes = 30) {
  const token = crypto.randomBytes(24).toString("hex");
  const expires = new Date(Date.now() + ttlMinutes * 60 * 1000);
  await pool.query(
    "insert into email_verification_tokens (user_id, token, expires_at) values ($1,$2,$3)",
    [user_id, token, expires.toISOString()]
  );
  return token;
}

router.post("/signup", async (req, res) => {
  try {
    const { company, email, password } = req.body;
    if (!company || !email || !password) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const exists = await pool.query("select id from users where email=$1", [email.toLowerCase()]);
    if (exists.rows.length) return res.status(400).json({ error: "Email already in use" });

    const hash = await bcrypt.hash(password, 10);
    const inserted = await pool.query(
      "insert into users (email, company_name, password_hash, role, verified) values ($1,$2,$3,$4,$5) returning id,email",
      [email.toLowerCase(), company, hash, "business", false]
    );
    const user = inserted.rows[0];

    const token = await createVerifyToken(user.id);
    const link = `${baseUrlFrom(req)}/auth/verify?token=${encodeURIComponent(token)}`;
    await sendVerificationEmail({ to: user.email, link });

    res.json({ message: "Signup successful. Check your email to verify your account." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Signup failed" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await findUserByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    if (!user.verified) {
      return res.status(403).json({ error: "Email not verified" });
    }

    const ok = await bcrypt.compare(String(password || ""), user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = signSession(user);
    res.cookie("session", token, devCookie);

    res.json({
      message: "Login successful",
      user: { id: user.id, email: user.email, role: user.role, company: user.company_name },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Login failed" });
  }
});

router.post("/logout", (_req, res) => {
  res.clearCookie("session", { path: "/" });
  return res.redirect(303, "/login.html");
});

router.post("/resend-verification", async (req, res) => {
  try {
    const { email } = req.body;
    const user = await findUserByEmail(email);
    if (!user) return res.status(200).json({ message: "If the account exists, an email was sent." });

    if (user.verified) return res.status(200).json({ message: "Already verified." });

    await pool.query("delete from email_verification_tokens where user_id=$1", [user.id]);

    const token = await createVerifyToken(user.id);
    const link = `${baseUrlFrom(req)}/auth/verify?token=${encodeURIComponent(token)}`;
    await sendVerificationEmail({ to: user.email, link });

    res.json({ message: "Verification email sent." });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Could not resend verification" });
  }
});

router.post("/signup-web", async (req, res) => {
  try {
    const { company, email, password } = req.body;
    if (!company || !email || !password) {
      return res.redirect("/signup.html?err=missing");
    }

    const exists = await pool.query("select id from users where email=$1", [String(email).toLowerCase()]);
    if (exists.rows.length) return res.redirect("/signup.html?err=exists");

    const hash = await bcrypt.hash(password, 10);
    const inserted = await pool.query(
      "insert into users (email, company_name, password_hash, role, verified) values ($1,$2,$3,$4,$5) returning id,email",
      [String(email).toLowerCase(), company, hash, "business", false]
    );
    const user = inserted.rows[0];

    const token = await createVerifyToken(user.id);
    const link = `${baseUrlFrom(req)}/auth/verify?token=${encodeURIComponent(token)}`;
    await sendVerificationEmail({ to: user.email, link });

    return res.redirect("/login.html?ok=verify");
  } catch (e) {
    console.error(e);
    return res.redirect("/signup.html?err=server");
  }
});

router.post("/login-web", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await findUserByEmail(email);
    if (!user) return res.redirect("/login.html?err=invalid");
    if (!user.verified) return res.redirect("/login.html?err=verify");

    const ok = await bcrypt.compare(String(password || ""), user.password_hash);
    if (!ok) return res.redirect("/login.html?err=invalid");

    const token = signSession(user);
    res.cookie("session", token, devCookie);

    return res.redirect(user.role === "admin" ? "/admin" : "system" ? "/system" : "/business");
  } catch (e) {
    console.error(e);
    return res.redirect("/login.html?err=server");
  }
});

router.get("/verify", async (req, res) => {
  try {
    const token = String(req.query.token || "");
    if (!token) return res.status(400).send("Missing token");

    const row = await pool.query(
      "select user_id, expires_at from email_verification_tokens where token=$1",
      [token]
    );
    if (!row.rows.length) return res.status(400).send("Invalid or expired token");

    const { user_id, expires_at } = row.rows[0];
    if (new Date(expires_at).getTime() < Date.now()) {
      await pool.query("delete from email_verification_tokens where token=$1", [token]);
      return res.status(400).send("Token expired");
    }

    await pool.query("update users set verified=true where id=$1", [user_id]);
    await pool.query("delete from email_verification_tokens where user_id=$1", [user_id]);

    return res.redirect("/login.html?ok=verified");
  } catch (e) {
    console.error(e);
    return res.status(500).send("Verification failed");
  }
});

export default router;
