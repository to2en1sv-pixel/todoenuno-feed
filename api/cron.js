module.exports = async (req, res) => {
  try {
    if (req.query.secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'no autorizado' });
    const USER_TOKEN = (process.env.USER_TOKEN || "").trim().replace(/"/g,'').replace(/\s+/g,'');
    const accRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&limit=100&access_token=${USER_TOKEN}`);
    const accData = await accRes.json();
    if (accData.error) return res.json({ facebook_error: accData.error });

    let results = [];
    for (const page of (accData.data || [])) {
      const token = page.access_token;
      const feedRes = await fetch(`https://graph.facebook.com/v20.0/${page.id}/feed?fields=id,comments.limit(20){id,message,from,is_hidden,created_time,comment_count}&limit=2&access_token=${token}`);
      const feedData = await feedRes.json();
      for (const post of (feedData.data || [])) {
        for (const c of (post.comments?.data || [])) {
          if (c.is_hidden) continue;
          if (c.comment_count > 0) continue;
          const msg = (c.message||'').toLowerCase();
          if (msg.includes('precio') || msg.includes('cuanto') || msg.includes('info')) {
            const text = `Hola! Info enviada al inbox ${Date.now()}`;
            const r = await fetch(`https://graph.facebook.com/v20.0/${c.id}/comments`, {
              method: 'POST',
              headers: {'Content-Type':'application/x-www-form-urlencoded'},
              body: `message=${encodeURIComponent(text)}&access_token=${token}`
            });
            const j = await r.json();
            results.push({ page: page.name, comment: c.message, fb_response: j });
          }
        }
      }
    }
    return res.json({ ok: true, debug: results });
  } catch (e) { return res.status(500).json({ error: e.message }); }
};
