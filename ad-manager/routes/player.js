import express from "express";
import pool from "../db.js";

const router = express.Router();

router.get("/feed", async (req, res) => {
  const display = parseInt(req.query.display || "1", 10);
  const limit = Math.min(parseInt(req.query.limit || "100", 10), 200);

  try {
    const ovr = await pool.query(
      `
      select do.display_id, do.campaign_id,
             c.title, c.file_url, c.scheduled_from, c.scheduled_to, c.created_at
        from public.display_overrides do
        join public.campaigns c on c.id = do.campaign_id
       where do.display_id = $1
         and do.valid_until >= now()
         and c.status = 'approved'
         and (c.scheduled_from is null or c.scheduled_from <= now())
         and (c.scheduled_to   is null or c.scheduled_to   >= now())
       order by do.valid_until desc
       limit 1
      `,
      [display]
    );
    const override = ovr.rows[0] || null;

    const q = await pool.query(
      `
      with agg as (
        select
          c.id, c.title, c.file_url, c.scheduled_from, c.scheduled_to, c.created_at,
          count(ct.display_id)              as target_count,
          count(*) filter (where ct.display_id = $1) as match_count
        from public.campaigns c
        left join public.campaign_targets ct on ct.campaign_id = c.id
        where c.status = 'approved'
          and (c.scheduled_from is null or c.scheduled_from <= now())
          and (c.scheduled_to   is null or c.scheduled_to   >= now())
        group by c.id, c.title, c.file_url, c.scheduled_from, c.scheduled_to, c.created_at
      )
      select id, title, file_url, scheduled_from, scheduled_to, created_at
      from agg
      where (target_count = 0 or match_count > 0)
      order by coalesce(scheduled_from, created_at) asc
      limit $2
      `,
      [display, limit]
    );

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

    const playlist = q.rows.map(makeItem);
    if (override) {
      const top = makeItem(override);
      if (!playlist.length || playlist[0].id !== top.id) playlist.unshift(top);
    }

    res.json({ display, playlist, serverTime: new Date().toISOString() });
  } catch (e) {
    console.error("[player/feed] SQL error:", e);
    res.status(500).json({ error: "feed_failed" });
  }
});

export default router;
