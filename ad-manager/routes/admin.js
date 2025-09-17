import express from "express";
import jwt from "jsonwebtoken";
import pool from "../db.js";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

const upload = multer({ limits: { fileSize: 100 * 1024 * 1024 } });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = process.env.SUPABASE_BUCKET || "ads";

function requireAdmin(req, res, next) {
  const token = req.cookies?.session;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    const user = jwt.verify(token, JWT_SECRET);
    if (user.role !== "admin") return res.status(403).json({ error: "Forbidden" });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid session" });
  }
}

router.get("/pending", requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `select c.id, c.title, c.file_url, c.created_at,
              c.scheduled_from, c.scheduled_to,
              u.company_name, u.email
         from campaigns c
         join users u on u.id = c.user_id
        where c.status = 'pending'
        order by c.created_at desc`
    );
    res.json(rows);
  } catch (e) {
    console.error("[admin/pending]", e);
    res.status(500).json({ error: "Failed to fetch pending campaigns" });
  }
});

router.get("/approved", requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `select c.id, c.title, c.file_url, c.created_at,
              c.scheduled_from, c.scheduled_to,
              u.company_name, u.email
         from campaigns c
         join users u on u.id = c.user_id
        where c.status = 'approved'
        order by c.created_at desc`
    );
    res.json(rows);
  } catch (e) {
    console.error("[admin/approved]", e);
    res.status(500).json({ error: "Failed to fetch approved campaigns" });
  }
});

router.post("/:id/approve", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rowCount } = await pool.query(
      `update campaigns set status='approved' where id=$1 and status='pending'`,
      [id]
    );
    if (!rowCount) return res.status(404).json({ error: "Not found or not pending" });
    res.json({ ok: true });
  } catch (e) {
    console.error("[admin/approve]", e);
    res.status(500).json({ error: "Approve failed" });
  }
});

router.post("/:id/deny", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rowCount } = await pool.query(
      `update campaigns set status='denied' where id=$1 and status='pending'`,
      [id]
    );
    if (!rowCount) return res.status(404).json({ error: "Not found or not pending" });
    res.json({ ok: true });
  } catch (e) {
    console.error("[admin/deny]", e);
    res.status(500).json({ error: "Deny failed" });
  }
});

router.post("/upload", requireAdmin, upload.single("file"), async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    if (!title) return res.status(400).json({ error: "Missing title" });
    if (!req.file) return res.status(400).json({ error: "Missing file" });

    let userId = req.user.id;
    if (req.body.user_email) {
      const q = await pool.query(`select id from users where email=$1`, [String(req.body.user_email).toLowerCase()]);
      if (q.rows[0]?.id) userId = q.rows[0].id;
    }

    const ext = (req.file.originalname.split(".").pop() || "bin").toLowerCase();
    const key = `${userId}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(key, req.file.buffer, {
      contentType: req.file.mimetype, upsert: false,
    });
    if (upErr) return res.status(500).json({ error: "Storage upload failed: " + upErr.message });

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(key);
    const file_url = pub?.publicUrl || key;

    const row = await pool.query(
      `insert into campaigns (user_id, title, file_url, status)
       values ($1,$2,$3,'approved')
       returning id, title, file_url, status, created_at`,
      [userId, title, file_url]
    );

    return res.json(row.rows[0]);
  } catch (e) {
    console.error("[admin/upload]", e);
    res.status(500).json({ error: "Admin upload failed" });
  }
});

router.post("/:id/delete", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(`select file_url from campaigns where id=$1`, [id]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });

    let fileUrl = rows[0].file_url || "";
    let key = null;
    const parts = fileUrl.split("/object/public/");
    if (parts[1]) {
      const after = parts[1];
      const idx = after.indexOf("/");
      if (idx !== -1) key = after.slice(idx + 1);
    }

    await pool.query(`delete from campaigns where id=$1`, [id]);
    if (key) await supabase.storage.from(BUCKET).remove([key]).catch(() => {});

    res.json({ ok: true });
  } catch (e) {
    console.error("[admin/delete]", e);
    res.status(500).json({ error: "Delete failed" });
  }
});

router.post("/send", requireAdmin, async (req, res) => {
  try {
    const campaign_id = Number(req.body.campaign_id);
    const display_id  = Number(req.body.display_id);
    const minutes     = Math.max(1, Math.min(60, Number(req.body.minutes || 10)));

    if (!Number.isInteger(campaign_id) || ![1,2,3].includes(display_id)) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const ok = await pool.query(
      `select id from public.campaigns
        where id = $1
          and status = 'approved'
          and (scheduled_from is null or scheduled_from <= now())
          and (scheduled_to   is null or scheduled_to   >= now())`,
      [campaign_id]
    );
    if (!ok.rows.length) {
      return res.status(400).json({ error: "Campaign not eligible (not approved / out of schedule)" });
    }

    const validUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();

    await pool.query(
      `insert into public.display_overrides (display_id, campaign_id, valid_until)
       values ($1,$2,$3)`,
      [display_id, campaign_id, validUntil]
    );

    return res.json({ ok: true, display_id, campaign_id, valid_until: validUntil });
  } catch (e) {
    console.error("[admin/send] error:", e);
    return res.status(500).json({ error: "manual_send_failed" });
  }
});

export default router;
