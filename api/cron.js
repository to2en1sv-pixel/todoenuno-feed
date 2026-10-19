module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  
  if (req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'secret incorrecto' });
  }

  try {
    const USER_TOKEN = (process.env.USER_TOKEN || '').trim();
    if (!USER_TOKEN) return res.json({ error: 'USER_TOKEN vacío en Vercel' });

    const accRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&limit=100&access_token=${USER_TOKEN}`);
    const accText = await accRes.text();
    let accData;
    try { accData = JSON.parse(accText); } catch { return res.json({ error: 'FB no devolvió JSON', raw: accText.slice(0,500) }); }
    
    if (accData.error) return res.json({ error_fb: accData.error });
    if (!accData.data) return res.json({ error: 'no data en accounts', accData });

    let borrados = [];

    for (const page of accData.data) {
      const token = page.access_token;
      
      const feedRes = await fetch(`https://graph.facebook.com/v20.0/${page.id}/feed?fields=id,comments.order(reverse_chronological).limit(20){id,message,from,created_time}&limit=10&access_token=${token}`);
      const feedText = await feedRes.text();
      let feedData;
      try { feedData = JSON.parse(feedText); } catch { continue; }

      for (const post of (feedData.data || [])) {
        for (const c of (post.comments?.data || [])) {
          if (!c.message) continue;
          if (c.from?.id === page.id) continue;

          const haceMin = (Date.now() - new Date(c.created_time).getTime()) / 60000;
          if (haceMin > 10) continue;

          const delRes = await fetch(`https://graph.facebook.com/v20.0/${c.id}?access_token=${token}`, { method: 'DELETE' });
          const delText = await delRes.text();
          let delData; try { delData = JSON.parse(delText); } catch { delData = { raw: delText }; }
          
          borrados.push({ comentario: c.message, resultado: delData });
        }
      }
    }

    return res.json({ ok: true, version: "v4-BORRAR-FIX", borrados });

  } catch (e) {
    return res.status(500).json({ error: e.message, stack: e.stack?.slice(0,500) });
  }
};
