export default async function handler(req, res) {
export default async function handler(req, res) {
  try {
    if (req.query.secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'no autorizado, revisa CRON_SECRET' });
    }
    const USER_TOKEN = process.env.USER_TOKEN;
    if (!USER_TOKEN) {
      return res.json({ error: "Falta USER_TOKEN en Vercel > Settings > Environment Variables" });
    }

    const BAD = ['estafa','estafador','falso','robo','ladron'];
    const PRICE = ['precio','cuanto','cuánto','info','valor','costo'];

    const accRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&limit=100&access_token=${USER_TOKEN}`);
    const accData = await accRes.json();
    
    if (accData.error) {
      return res.json({ facebook_error: accData.error, hint: "Tu USER_TOKEN expiró, genera uno nuevo de 60 días" });
    }

    let results = [];
    
    for (const page of (accData.data || [])) {
      const pageId = page.id;
      const token = page.access_token;
      try {
        const feedUrl = `https://graph.facebook.com/v20.0/${pageId}/feed?fields=id,comments.limit(25){id,message,from,is_hidden,created_time,comment_count}&limit=3&access_token=${token}`;
        const feedData = await (await fetch(feedUrl)).json();
        
        for (const post of feedData.data || []) {
          for (const c of post.comments?.data || []) {
            if (c.is_hidden) continue;
            if (c.comment_count > 0) continue;
            const age = Date.now() - new Date(c.created_time).getTime();
            if (age > 10*60*1000) continue;
            
            const msg = (c.message||'').toLowerCase();
            if (BAD.some(w=>msg.includes(w))) {
              await fetch(`https://graph.facebook.com/v20.0/${c.id}?is_hidden=true&access_token=${token}`, {method:'POST'});
              results.push(`OCULTADO en ${page.name}: ${c.message}`);
            } else if (PRICE.some(w=>msg.includes(w))) {
              const text = encodeURIComponent('¡Hola! Te escribimos al inbox con la info 😊');
              await fetch(`https://graph.facebook.com/v20.0/${c.id}/comments?message=${text}&access_token=${token}`, {method:'POST'});
              results.push(`RESPONDIDO en ${page.name}: ${c.message}`);
            }
          }
        }
      } catch(e) {
        results.push(`Error en ${page.name}: ${e.message}`);
      }
    }

    return res.json({ 
      ok: true, 
      paginas_detectadas: accData.data.map(p=>p.name),
      total_paginas: accData.data.length,
      acciones: results 
    });

  } catch (err) {
    return res.status(500).json({ error_catch: err.message, stack: err.stack });
  }
}
