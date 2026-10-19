export default async function handler(req, res) {
  // --- SEGURIDAD ---
  const MY_SECRET = process.env.CRON_SECRET || "123456";
  if (req.query.secret !== MY_SECRET) {
    return res.status(401).json({ error: 'no autorizado. Usa ?secret=123456' });
  }

  const PAGES = [
    { 
      id: '112480793428483', 
      token: process.env.PAGE_TOKEN_SALVADORENO, 
      name: 'Salvadoreño' 
    },
    // Cuando quieras agregar Angelof y Mad:
    // { id: 'ID_DE_ANGELOF', token: process.env.PAGE_TOKEN_ANGELOF, name: 'Angelof' },
    // { id: 'ID_DE_MAD', token: process.env.PAGE_TOKEN_MAD, name: 'Mad' },
  ];

  const BAD_WORDS = ['estafa', 'estafador', 'falso', 'robo', 'ladron', 'mentira'];
  const PRICE_WORDS = ['precio', 'cuanto', 'cuánto', 'info', 'informacion', 'valor'];

  let results = [];
  let errors = [];

  for (const page of PAGES) {
    if (!page.token) {
      errors.push(`[${page.name}] NO TIENE TOKEN`);
      continue;
    }

    const feedUrl = `https://graph.facebook.com/v20.0/${page.id}/feed?fields=id,message,comments.limit(25){id,message,from,is_hidden,created_time}&limit=5&access_token=${page.token}`;
    const feedRes = await fetch(feedUrl);
    const feedData = await feedRes.json();

    if (feedData.error) {
      errors.push(`[${page.name}] ERROR FB: ${JSON.stringify(feedData.error)}`);
      continue;
    }
    if (!feedData.data) continue;

    for (const post of feedData.data) {
      if (!post.comments?.data) continue;

      for (const comment of post.comments.data) {
        if (comment.is_hidden) continue;
        const msg = (comment.message || '').toLowerCase();
        // 30 min para que puedas probar, luego lo bajas a 10
        const isRecent = (Date.now() - new Date(comment.created_time).getTime()) < 10 * 60 * 1000;
        if (!isRecent) continue;

        // 1. Ocultar insultos
        if (BAD_WORDS.some(w => msg.includes(w))) {
          await fetch(`https://graph.facebook.com/v20.0/${comment.id}?is_hidden=true&access_token=${page.token}`, { method: 'POST' });
          results.push(`[${page.name}] OCULTADO: ${comment.message}`);
          continue;
        }

        // 2. Responder precios
        if (PRICE_WORDS.some(w => msg.includes(w))) {
          const reply = `¡Hola! Te escribimos al inbox con la info 😊`;
          await fetch(`https://graph.facebook.com/v20.0/${comment.id}/comments?message=${encodeURIComponent(reply)}&access_token=${page.token}`, { method: 'POST' });
          results.push(`[${page.name}] RESPONDIDO: ${comment.message}`);
        }
      }
    }
  }

  res.status(200).json({ ok: true, processed: results, errors });
}
