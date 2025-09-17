import express from "express";
import pool from "../db.js";

const router = express.Router();

router.get("/feed", async (req, res) => {
  const display = Math.max(1, Math.min(3, parseInt(req.query.display || "1", 10)));
  const limit = Math.min(parseInt(req.query.limit || "100", 10), 200);
  const diag = req.query.diag === "1";

  const toItem = (r) => {
    const isImage = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(r.file_url || "");
    return {
      id: r.id,
      title: r.title,
      url: r.file_url,
      type: isImage ? "image" : "video",
      duration: isImage ? 10 : null,
      scheduled_from: r.scheduled_from,
      scheduled_to: r.scheduled_to
    };
  };

  try {
const { rows: ovrRows } = await pool.query(
  `
  select do.display_id, do.campaign_id,
         c.id, c.title, c.file_url, c.scheduled_from, c.scheduled_to
    from public.display_overrides do
    join public.campaigns c on c.id = do.campaign_id
   where do.display_id = $1
     and do.valid_until >= now()
     and c.status = 'approved'
   order by do.valid_until desc
   limit 1
  `,
  [display]
);

    const override = ovrRows[0] || null;

    const { rows } = await pool.query(
      `
      select c.id, c.title, c.file_url, c.scheduled_from, c.scheduled_to
        from public.campaigns c
       where c.status = 'approved'
         and (c.scheduled_from is null or c.scheduled_from <= now())
         and (c.scheduled_to   is null or c.scheduled_to   >= now())
         and (
              not exists (select 1 from public.campaign_targets ct where ct.campaign_id = c.id)
              or exists   (select 1 from public.campaign_targets ct where ct.campaign_id = c.id and ct.display_id = $1)
         )
       order by coalesce(c.scheduled_from, now()) asc
       limit $2
      `,
      [display, limit]
    );

    const playlist = rows.map(toItem);
    if (override) {
      const top = toItem(override);
      if (!playlist.length || playlist[0].id !== top.id) playlist.unshift(top);
    }

    return res.json({ display, playlist, serverTime: new Date().toISOString() });
  } catch (e) {
    console.error("[player/feed] SQL error:", e);
    if (diag) {
      return res.status(500).json({
        error: "feed_failed",
        details: e?.message || String(e)
      });
    }

    try {
      const { rows } = await pool.query(
        `
        select id, title, file_url, scheduled_from, scheduled_to
          from public.campaigns
         where status = 'approved'
           and (scheduled_from is null or scheduled_from <= now())
           and (scheduled_to   is null or scheduled_to   >= now())
         order by coalesce(scheduled_from, now()) asc
         limit $1
        `,
        [limit]
      );
      return res.json({ display, playlist: rows.map(toItem), degraded: true });
    } catch (e2) {
      console.error("[player/feed] fallback SQL error:", e2);
      return res.status(500).json({ error: "feed_failed" });
    }
  }
});

export default router;
