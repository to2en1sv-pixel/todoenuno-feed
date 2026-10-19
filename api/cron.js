module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.query.secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'secret malo' });
    const USER_TOKEN = (process.env.USER_TOKEN||'').trim();
    const accRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&limit=100&access_token=${USER_TOKEN}`);
    const accData = await accRes.json();

    for (const page of (accData.data||[])) {
      const token = page.access_token;
      const feedRes = await fetch(`https://graph.facebook.com/v20.0/${page.id}/feed?fields=id,comments.order(reverse_chronological).limit(20){id,message,from,created_time,comments.limit(10){from}}&limit=2&access_token=${token}`);
      const feedData = await feedRes.json();
      for (const post of (feedData.data||[])) {
        for (const c of (post.comments?.data||[])) {
          if (!c.message) continue;
          if (!c.message.toLowerCase().includes('precio')) continue;
          const haceMin = (Date.now() - new Date(c.created_time).getTime()) / 60000;
          if (haceMin > 10) continue;
          const ya = (c.comments?.data||[]).some(r => r.from?.id === page.id);
          if (ya) continue;

          // Texto ultra corto que no activa el filtro de spam
          const text = `Hola ${c.from?.name?.split(' ')[0]||''}! 😊`;
          const r = await fetch(`https://graph.facebook.com/v20.0/${c.id}/comments`, {
            method: 'POST',
            headers: {'Content-Type':'application/x-www-form-urlencoded'},
            body: `message=${encodeURIComponent(text)}&access_token=${token}`
          });
          const j = await r.json();
          if (j.id) {
            await fetch(`https://graph.facebook.com/v20.0/${j.id}`, {
              method: 'POST',
              headers: {'Content-Type':'application/x-www-form-urlencoded'},
              body: `is_hidden=false&access_token=${token}`
            });
          }
        }
      }
    }
    return res.json({ ok: true, v: "v6-texto-simple" });
  } catch (e) { return res.json({ error: e.message }); }
};
