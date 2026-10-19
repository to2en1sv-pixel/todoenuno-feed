module.exports = async (req, res) => {
  try {
    if (req.query.secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'no autorizado' });
    }
  const USER_TOKEN = (process.env.USER_TOKEN || "").trim().replace(/"/g,'').replace(/\s+/g,'');
    if (!USER_TOKEN) {
      return res.json({ error: "Falta USER_TOKEN" });
    }

    const BAD = ['estafa','estafador','falso','robo','ladron'];
    const PRICE = ['precio','cuanto','cuánto','info','valor','costo'];

    const accRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&limit=100&access_token=${USER_TOKEN}`);
    const accData = await accRes.json();
    
    if (accData.error) {
      return res.json({ facebook_error: accData.error });
    }

    let results = [];
    
    for (const page of (accData.data || [])) {
      const pageId = page.id;
      const token = page.access_token;
      try {
        const feedUrl = `https://graph.facebook.com/v20.0/${pageId}/feed?fields=id,comments.limit(25){id,message,from,is_hidden,created_time,comment_count}&limit=3&access_token=${token}`;
        const feedRes = await fetch(feedUrl);
        const feedData = await feedRes.json();
        
        for (const post of (feedData.data || [])) {
          for (const c of (post.comments?.data || [])) {
            if (c.is_hidden) continue;
            if (c.comment_count > 0) continue;
            const age = Date.now() - new Date(c.created_time).getTime();
            if (age > 10*60*1000) continue;
            
            const msg = (c.message||'').toLowerCase();
            if (BAD.some(w=>msg.includes(w))) {
              await fetch(`https://graph.facebook.com/v20.0/${c.id}?is_hidden=true&access_token=${token}`, {method:'POST'});
              results.push(`OCULTADO en ${page.name}`);
            } else if (PRICE.some(w=>msg.includes(w))) {
              const text = encodeURIComponent('Hola! Te escribimos al inbox con la info');
              await fetch(`https://graph.facebook.com/v20.0/${c.id}/comments?message=${text}&access_token=${token}`, {method:'POST'});
              results.push(`RESPONDIDO en ${page.name}`);
            }
          }
        }
      } catch(e) {}
    }

    return res.json({ 
      ok: true, 
      paginas: accData.data.map(p=>p.name),
      total: accData.data.length,
      acciones: results 
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
