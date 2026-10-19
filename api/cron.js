module.exports = async (req, res) => {
  try {
    if (req.query.secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'no autorizado' });
    const USER_TOKEN = (process.env.USER_TOKEN || "").trim().replace(/"/g,'').replace(/\s+/g,'');
    if (!USER_TOKEN) return res.json({ error: "Falta USER_TOKEN" });

    const BAD = ['estafa','estafador','falso','robo','ladron','ladrón'];
    const PRICE = ['precio','cuanto','cuánto','info','informacion','valor','costo'];

    const accRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&limit=100&access_token=${USER_TOKEN}`);
    const accData = await accRes.json();
    if (accData.error) return res.json({ facebook_error: accData.error });

    let results = [];
    
    for (const page of (accData.data || [])) {
      const token = page.access_token;
      const feedRes = await fetch(`https://graph.facebook.com/v20.0/${page.id}/feed?fields=id,comments.limit(25){id,message,from,is_hidden,created_time,comment_count}&limit=3&access_token=${token}`);
      const feedData = await feedRes.json();
      
      for (const post of (feedData.data || [])) {
        for (const c of (post.comments?.data || [])) {
          if (c.is_hidden) continue;
          if (c.comment_count > 0) continue;
          const age = Date.now() - new Date(c.created_time).getTime();
          if (age > 10*60*1000) continue;
          
          const msg = (c.message||'').toLowerCase();
          
          if (BAD.some(w=>msg.includes(w))) {
            const r = await fetch(`https://graph.facebook.com/v20.0/${c.id}`, {
              method: 'POST',
              headers: {'Content-Type':'application/x-www-form-urlencoded'},
              body: `is_hidden=true&access_token=${token}`
            });
            const j = await r.json();
            results.push(`OCULTADO en ${page.name}: ${c.message} -> FB: ${JSON.stringify(j)}`);
            
          } else if (PRICE.some(w=>msg.includes(w))) {
            const text = `Hola ${c.from?.name || ''}! Te escribimos al inbox con la info 😊 ${Date.now().toString().slice(-3)}`;
            const r = await fetch(`https://graph.facebook.com/v20.0/${c.id}/comments`, {
              method: 'POST',
              headers: {'Content-Type':'application/x-www-form-urlencoded'},
              body: `message=${encodeURIComponent(text)}&access_token=${token}`
            });
            const j = await r.json();
            results.push(`RESPONDIDO en ${page.name}: ${c.message} -> FB: ${JSON.stringify(j)}`);
          }
        }
      }
    }
    return res.json({ ok: true, paginas: accData.data.map(p=>p.name), total: accData.data.length, acciones: results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
