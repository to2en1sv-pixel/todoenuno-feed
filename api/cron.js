export default async function handler(req, res) {
  if (req.query.secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'no autorizado' });
  const USER_TOKEN = process.env.USER_TOKEN;
  if (!USER_TOKEN) return res.json({ error: "Falta USER_TOKEN en Vercel" });

  const BAD = ['estafa','estafador','falso','robo','ladron'];
  const PRICE = ['precio','cuanto','cuánto','info','valor','costo'];

  // 1. Con tu USER_TOKEN, pide TODAS tus páginas automáticamente
  const accRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&limit=100&access_token=${USER_TOKEN}`);
  const accData = await accRes.json();
  if (accData.error) return res.json({ error: accData.error.message, token: USER_TOKEN.slice(0,20)+'...' });
  
  let results = [];
  let errors = [];

  // 2. Recorre las 16 páginas que te devolvió Facebook
  for (const page of accData.data) {
    const pageId = page.id;
    const token = page.access_token; // token eterno de cada página
    try {
      const feedUrl = `https://graph.facebook.com/v20.0/${pageId}/feed?fields=id,comments.limit(25){id,message,from,is_hidden,created_time,comment_count}&limit=3&access_token=${token}`;
      const feedData = await (await fetch(feedUrl)).json();
      if (feedData.error) { errors.push(`${page.name}: ${feedData.error.message}`); continue; }

      for (const post of feedData.data || []) {
        for (const c of post.comments?.data || []) {
          if (c.is_hidden) continue;
          if (c.comment_count > 0) continue; // anti-spam: ya respondido
          if ((Date.now() - new Date(c.created_time)) > 10*60*1000) continue;
          const msg = (c.message||'').toLowerCase();

          if (BAD.some(w=>msg.includes(w))) {
            await fetch(`https://graph.facebook.com/v20.0/${c.id}?is_hidden=true&access_token=${token}`, {method:'POST'});
            results.push(`OCULTADO en ${page.name}`);
          } else if (PRICE.some(w=>msg.includes(w))) {
            await fetch(`https://graph.facebook.com/v20.0/${c.id}/comments?message=${encodeURIComponent('¡Hola! Te escribimos al inbox con la info 😊')}&access_token=${token}`, {method:'POST'});
            results.push(`RESPONDIDO en ${page.name}`);
          }
        }
      }
    } catch(e){ errors.push(`${page.name}: ${e.message}`); }
  }
  res.json({ ok: true, paginas_detectadas: accData.data.map(p=>p.name), processed: results, errors });
}
  res.status(200).json({ ok: true, processed: results, errors });
}
