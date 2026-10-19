module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.query.secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'secret malo' });
    const USER_TOKEN = (process.env.USER_TOKEN||'').trim();
    const accRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&limit=100&access_token=${USER_TOKEN}`);
    const accData = await accRes.json();
    if (accData.error) return res.json(accData);

    let debug = [];
    for (const page of (accData.data||[])) {
      const token = page.access_token;
      const feedRes = await fetch(`https://graph.facebook.com/v20.0/${page.id}/feed?fields=id,comments.limit(10){id,message,from,comment_count}&limit=2&access_token=${token}`);
      const feedData = await feedRes.json();
      for (const post of (feedData.data||[])) {
        for (const c of (post.comments?.data||[])) {
          if (!c.message) continue;
          if (c.comment_count > 0) continue; // ya respondido, no volver a responder
          const low = c.message.toLowerCase();
          if (low.includes('precio') || low.includes('cuanto') || low.includes('costo') || low.includes('info')) {
            const text = `Hola ${c.from?.name||''}! Te enviamos la info por mensaje privado, revisa tus solicitudes 😊`;
            const r = await fetch(`https://graph.facebook.com/v20.0/${c.id}/comments`, {
              method: 'POST',
              headers: {'Content-Type':'application/x-www-form-urlencoded'},
              body: `message=${encodeURIComponent(text)}&access_token=${token}`
            });
            const j = await r.json();
            // si lo creó, aseguramos que no quede oculto
            if (j.id) {
              await fetch(`https://graph.facebook.com/v20.0/${j.id}`, {
                method: 'POST',
                headers: {'Content-Type':'application/x-www-form-urlencoded'},
                body: `is_hidden=false&access_token=${token}`
              });
            }
            debug.push({ coment: c.message, fb_respuesta: j });
          }
        }
      }
    }
    return res.json({ ok: true, version: "v3-unhide", debug });
  } catch (e) { return res.json({ error: e.message }); }
};
