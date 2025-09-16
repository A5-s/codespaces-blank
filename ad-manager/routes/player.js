import express from "express";
import pool from "../db.js";

const router = express.Router();

router.get("/feed", async (req, res) => {
  const display = Math.max(1, Math.min(3, parseInt(req.query.display || "1", 10)));
  const limit = Math.min(parseInt(req.query.limit || "100", 10), 200);

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
         and (c.scheduled_from is null or c.scheduled_from <= now())
         and (c.scheduled_to   is null or c.scheduled_to   >= now())
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
          -- global if no targets exist
          not exists (
            select 1 from public.campaign_targets ct
             where ct.campaign_id::text = c.id::text
          )
          -- or explicitly targeted to this display
          or exists (
            select 1 from public.campaign_targets ct
             where ct.campaign_id::text = c.id::text
               and ct.display_id = $1
          )
     )
   order by coalesce(c.scheduled_from, now()) asc
   limit $2
  `,
  [display, limit]
);

    // Build playlist
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
    const playlist = rows.map(toItem);

    if (override) {
      const top = toItem(override);
      if (!playlist.length || playlist[0].id !== top.id) playlist.unshift(top);
    }

    res.json({ display, playlist, serverTime: new Date().toISOString() });
  } catch (e) {
    console.error("[player/feed] SQL error:", e);
    res.status(500).json({ error: "feed_failed" });
  }
});

router.get("/diag", async (_req, res) => {
  const out = {};
  async function tryQuery(name, sql) {
    try {
      const r = await pool.query(sql);
      out[name] = { ok: true, rows: r.rows.length };
    } catch (e) {
      out[name] = { ok: false, error: String(e.message || e) };
    }
  }
  await tryQuery("campaigns_exists", "select 1 from public.campaigns limit 1");
  await tryQuery("campaigns_columns", `
    select column_name from information_schema.columns
    where table_schema='public' and table_name='campaigns' 
      and column_name in ('id','title','file_url','status','scheduled_from','scheduled_to')`);
  await tryQuery("campaign_targets_exists", "select 1 from public.campaign_targets limit 1");
  await tryQuery("display_overrides_exists", "select 1 from public.display_overrides limit 1");
  await tryQuery("displays_exists", "select 1 from public.displays limit 1");
  res.json(out);
});

export default router;
