module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.query.secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'no autorizado, secret mal' });
  const USER_TOKEN = (process.env.USER_TOKEN||'').trim().replace(/"/g,'');
  const accRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&limit=100&access_token=${USER_TOKEN}`);
  const accData = await accRes.json();
  if (accData.error) return res.json({ facebook_error: accData.error });

  let debug = [];
  for (const page of (accData.data||[])) {
    const token = page.access_token;
    const feedRes = await fetch(`https://graph.facebook.com/v20.0/${page.id}/feed?fields=id,comments.limit(10){id,message,from,created_time}&limit=2&access_token=${token}`);
    const feedData = await feedRes.json();
    for (const post of (feedData.data||[])) {
      for (const c of (post.comments?.data||[])) {
        const msg = (c.message||'').toLowerCase();
        if (msg.includes('precio') || msg.includes('cuanto')) {
          const text = `Hola! te enviamos info por inbox ${Date.now()}`;
          const r = await fetch(`https://graph.facebook.com/v20.0/${c.id}/comments`, {
            method: 'POST',
            headers: {'Content-Type':'application/x-www-form-urlencoded'},
            body: `message=${encodeURIComponent(text)}&access_token=${token}`
          });
          const j = await r.json();
          debug.push({ page: page.name, comment: c.message, fb: j });
        }
      }
    }
  }
  return res.json({ ok: true, debug });
};
