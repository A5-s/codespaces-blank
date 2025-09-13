// routes/player.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

/**
 * GET /api/player/feed
 * Returns approved campaigns that are currently active (or unscheduled).
 * Optional query:
 *   ?limit=50
 */
router.get("/feed", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 200);

    // only approved and within schedule window OR no schedule set
    const { rows } = await pool.query(
      `
      select id, title, file_url, scheduled_from, scheduled_to
      from campaigns
      where status = 'approved'
        and (
          (scheduled_from is null or scheduled_from <= now())
          and (scheduled_to   is null or scheduled_to   >= now())
        )
      order by coalesce(scheduled_from, created_at) asc
      limit $1
      `,
      [limit]
    );

    // Add a suggested duration: 10s for images, video = 'auto' (use metadata)
    const playlist = rows.map(r => {
      const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(r.file_url || "");
      return {
        id: r.id,
        title: r.title,
        url: r.file_url,
        type: isImage ? "image" : "video",
        duration: isImage ? 10 : null, // seconds for images; null = let video play to end
        scheduled_from: r.scheduled_from,
        scheduled_to: r.scheduled_to,
      };
    });

    res.json({ playlist, serverTime: new Date().toISOString() });
  } catch (e) {
    console.error("[player/feed]", e);
    res.status(500).json({ error: "Failed to load feed" });
  }
});

export default router;