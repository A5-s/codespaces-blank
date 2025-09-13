// routes/campaigns.js
import express from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import pool from "../db.js";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { sendCampaignDeletedEmail } from "../mailer.js";

const router = express.Router();
const upload = multer({ limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = process.env.SUPABASE_BUCKET || "ads";

function requireAuth(req, res, next) {
  const token = req.cookies?.session;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid session" });
  }
}

// small helper: purge soft-deleted > 7 days (runs opportunistically on write/list)
async function cleanupDeleted() {
  await pool.query(`delete from campaigns where status='deleted' and deleted_at < now() - interval '7 days'`);
}

// POST /api/campaigns/upload (multipart/form-data) with optional schedule fields
router.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  if (req.user.role !== "business") return respond({ error: "Forbidden" });

  const title = String(req.body.title || "").trim();
  if (!title) return respond({ error: "Missing title" });
  if (!req.file) return respond({ error: "Missing file" });

  const scheduled_from = req.body.scheduled_from ? new Date(req.body.scheduled_from) : null;
  const scheduled_to   = req.body.scheduled_to   ? new Date(req.body.scheduled_to)   : null;

  if (scheduled_from && isNaN(scheduled_from)) return respond({ error: "Invalid scheduled_from" });
  if (scheduled_to && isNaN(scheduled_to)) return respond({ error: "Invalid scheduled_to" });

  const ext = (req.file.originalname.split(".").pop() || "bin").toLowerCase();
  const key = `${req.user.id}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;

  try {
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(key, req.file.buffer, {
      contentType: req.file.mimetype, upsert: false,
    });
    if (upErr) return respond({ error: "Storage upload failed: " + upErr.message });

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(key);
    const file_url = pub?.publicUrl || key;

    const row = await pool.query(
      `insert into campaigns (user_id, title, file_url, status, scheduled_from, scheduled_to)
       values ($1,$2,$3,'pending',$4,$5)
       returning id, title, file_url, status, created_at, scheduled_from, scheduled_to`,
      [req.user.id, title, file_url, scheduled_from, scheduled_to]
    );

    await cleanupDeleted();
    return respond(row.rows[0], true);
  } catch (e) {
    console.error("[campaigns/upload]", e);
    return respond({ error: "Upload failed" });
  }

  function respond(payload, ok=false) {
    const wantsJson = (req.headers.accept || "").includes("application/json");
    if (!wantsJson) {
      const q = ok ? "ok=uploaded" : "err=" + encodeURIComponent(payload.error || "upload");
      return res.redirect(303, "/business?" + q);
    }
    return res.status(ok ? 200 : 400).json(payload);
  }
});

// GET /api/campaigns/list  (business user's own, excluding deleted)
router.get("/list", requireAuth, async (req, res) => {
  try {
    const rows = await pool.query(
      `select id, title, file_url, status, created_at, scheduled_from, scheduled_to
         from campaigns
        where user_id=$1 and status <> 'deleted'
        order by created_at desc`,
      [req.user.id]
    );
    await cleanupDeleted();
    res.json(rows.rows);
  } catch (e) {
    console.error("[campaigns/list]", e);
    res.status(500).json({ error: "Could not fetch campaigns" });
  }
});

// POST /api/campaigns/:id/delete  (business soft-delete own ad)
router.post("/:id/delete", requireAuth, async (req, res) => {
  if (req.user.role !== "business") return res.status(403).json({ error: "Forbidden" });
  const id = Number(req.params.id);
  try {
    // verify ownership & get info
    const q = await pool.query(
      `select c.id, c.title, c.file_url, u.email
         from campaigns c
         join users u on u.id = c.user_id
        where c.id=$1 and c.user_id=$2 and c.status <> 'deleted'`,
      [id, req.user.id]
    );
    if (!q.rows.length) return res.status(404).json({ error: "Not found" });
    const { title, email } = q.rows[0];

    // soft delete, set recover token
    const token = crypto.randomBytes(24).toString("hex");
    await pool.query(
      `update campaigns
          set status='deleted', deleted_at=now(), recover_token=$1
        where id=$2`,
      [token, id]
    );

    // email with recover link (no auth required to recover via token)
    const base = (req.headers["x-forwarded-proto"] ? `${req.headers["x-forwarded-proto"]}://${req.headers.host}` : `${req.protocol}://${req.headers.host}`);
    const recoverLink = `${base}/api/campaigns/recover?token=${encodeURIComponent(token)}`;

    await sendCampaignDeletedEmail({ to: email, campaignTitle: title, recoverLink }).catch(err => {
      console.error("[sendCampaignDeletedEmail]", err?.message || err);
    });

    await cleanupDeleted();
    res.json({ ok: true });
  } catch (e) {
    console.error("[campaigns/delete]", e);
    res.status(500).json({ error: "Delete failed" });
  }
});

router.get("/recover", async (req, res) => {
  const token = String(req.query.token || "");
  if (!token) return res.status(400).send("Missing token");
  try {
    const q = await pool.query(
      `select id, status, deleted_at from campaigns
        where recover_token=$1`,
      [token]
    );
    if (!q.rows.length) return res.status(400).send("Invalid token");
    const row = q.rows[0];
    if (row.status !== "deleted") return res.status(400).send("Already active");
    if (new Date(row.deleted_at).getTime() < Date.now() - 7*24*60*60*1000)
      return res.status(400).send("Recovery window expired");

    await pool.query(
      `update campaigns
          set status='pending', recover_token=NULL, deleted_at=NULL
        where id=$1`,
      [row.id]
    );
    return res.redirect("/business?ok=recovered");
  } catch (e) {
    console.error("[campaigns/recover]", e);
    return res.status(500).send("Recovery failed");
  }
});

export default router;