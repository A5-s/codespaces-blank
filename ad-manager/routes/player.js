// routes/player.js
import express from "express";
import pool from "../db.js";

const router = express.Router();

/**
 * GET /api/player/feed?display=1&limit=50
 * - Shows approved & in-window campaigns.
 * - If campaign has explicit targets, only show those matching ?display.
 * - If a valid override exists for ?display, it is prepended.
 */
router.get("/feed", async (req, res) => {
  try {
    const display = parseInt(req.query.display || "1", 10);
    const limit = Math.min(parseInt(req.query.limit || "100", 10), 200);

    // 1) Active override (if any)
    const ovr = await pool.query(
      `select do.display_id, do.campaign_id, c.title, c.file_url, c.scheduled_from, c.scheduled_to
         from display_overrides do
         join campaigns c on c.id = do.campaign_id
        where do.display_id = $1
          and do.valid_until >= now()
          and c.status = 'approved'
          and (c.scheduled_from is null or c.scheduled_from <= now())
          and (c.scheduled_to   is null or c.scheduled_to   >= now())
        order by do.valid_until desc
        limit 1`,
      [display]
    );
    const override = ovr.rows[0] || null;

    // 2) Approved & scheduled campaigns for this display
    // rule: if campaign has targets => must include this display
    //       if campaign has no targets => shown for all displays
    const { rows } = await pool.query(
      `
      with targeted as (
        select c.id, c.title, c.file_url, c.scheduled_from, c.scheduled_to
          from campaigns c
          left join campaign_targets t on t.campaign_id = c.id
         where c.status = 'approved'
           and (c.scheduled_from is null or c.scheduled_from <= now())
           and (c.scheduled_to   is null or c.scheduled_to   >= now())
         group by c.id, c.title, c.file_url, c.scheduled_from, c.scheduled_to
         having bool_or(t.display_id = $1)        -- TRUE if any target matches this display
             or bool_and(t.display_id is null)    -- TRUE if no targets at all
      )
      select * from targeted
      order by coalesce(scheduled_from, now()) asc
      limit $2
      `,
      [display, limit]
    );

    // 3) Build playlist
    const makeItem = (r) => {
      const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(r.file_url || "");
      return {
        id: r.id,
        title: r.title,
        url: r.file_url,
        type: isImage ? "image" : "video",
        duration: isImage ? 10 : null,
        scheduled_from: r.scheduled_from,
        scheduled_to: r.scheduled_to,
      };
    };

    const playlist = rows.map(makeItem);
    if (override) {
      // Prepend override ad if it's not already first
      const o = makeItem(override);
      if (!playlist.length || playlist[0].id !== o.id) {
        playlist.unshift(o);
      }
    }

    res.json({ display, playlist, serverTime: new Date().toISOString() });
  } catch (e) {
    console.error("[player/feed]", e);
    res.status(500).json({ error: "Failed to load feed" });
  }
});

export default router;
