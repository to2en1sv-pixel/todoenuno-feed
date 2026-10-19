module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.query.secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'secret malo' });
    const USER_TOKEN = (process.env.USER_TOKEN||'').trim();
    const accRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&limit=100&access_token=${USER_TOKEN}`);
    const accData = await accRes.json();
    if (accData.error) return res.json(accData);

    let debug = [];
    let vistos = [];
    for (const page of (accData.data||[])) {
      const token = page.access_token;
      // traemos 20 comentarios en orden de más nuevo primero
      const feedRes = await fetch(`https://graph.facebook.com/v20.0/${page.id}/feed?fields=id,comments.order(reverse_chronological).limit(20){id,message,from,comment_count,created_time}&limit=3&access_token=${token}`);
      const feedData = await feedRes.json();
      for (const post of (feedData.data||[])) {
        for (const c of (post.comments?.data||[])) {
          if (!c.message) continue;
          vistos.push({ msg: c.message, time: c.created_time, count: c.comment_count });
          // quitamos el filtro de comment_count para que vuelva a responder
          const low = c.message.toLowerCase();
          if (low.includes('precio') || low.includes('cuanto') || low.includes('costo') || low.includes('info')) {
            // solo responde a comentarios de las últimas 10 minutos para no spamear viejos
            const haceMin = (Date.now() - new Date(c.created_time).getTime()) / 60000;
            if (haceMin > 15) continue;
            const text = `Hola! Ya te enviamos la info al privado 😊`;
            const r = await fetch(`https://graph.facebook.com/v20.0/${c.id}/comments`, {
              method: 'POST',
              headers: {'Content-Type':'application/x-www-form-urlencoded'},
              body: `message=${encodeURIComponent(text)}&access_token=${token}`
            });
            const j = await r.json();
            debug.push({ original: c.message, hace_min: Math.round(haceMin), fb: j });
          }
        }
      }
    }
    return res.json({ ok: true, version: "v5-fresco", comentarios_vistos: vistos.slice(0,10), respuestas: debug });
  } catch (e) { return res.json({ error: e.message }); }
};
