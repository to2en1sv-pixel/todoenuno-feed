module.exports = async (req, res) => {
  // versión 1 salvadoreña - la que sí funcionó
  if (req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'secret no vale verga' });
  }

  try {
    const USER_TOKEN = (process.env.USER_TOKEN || '').trim();
    
    // agarramos las páginas
    const accRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&limit=100&access_token=${USER_TOKEN}`);
    const accData = await accRes.json();
    if (accData.error) return res.status(500).json(accData);

    let todo = [];

    for (const page of (accData.data || [])) {
      const pageToken = page.access_token;
      const pageId = page.id;

      // traemos los últimos 10 posts con sus comentarios
      const feedUrl = `https://graph.facebook.com/v20.0/${pageId}/feed?fields=id,comments.limit(30){id,message,from,created_time}&limit=10&access_token=${pageToken}`;
      const feedRes = await fetch(feedUrl);
      const feedData = await feedRes.json();

      for (const post of (feedData.data || [])) {
        const comentarios = post.comments?.data || [];
        
        for (const com of comentarios) {
          if (!com.message) continue;
          
          const msg = com.message.toLowerCase();
          if (msg.includes('precio') || msg.includes('cuanto') || msg.includes('cuánto') || msg.includes('costo') || msg.includes('valor')) {
            
            // solo si es de los últimos 30 min pa no spamear viejos
            const haceMin = (Date.now() - new Date(com.created_time).getTime()) / 60000;
            if (haceMin > 30) continue;

            const nombre = com.from?.name || 'amigo';
            const respuesta = `Hola ${nombre}! Te escribimos al privado con la info 😊`;

            // responder
            const replyRes = await fetch(`https://graph.facebook.com/v20.0/${com.id}/comments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `message=${encodeURIComponent(respuesta)}&access_token=${pageToken}`
            });
            const replyData = await replyRes.json();

            todo.push({ 
              comentario: com.message, 
              post: post.id, 
              respuesta: replyData 
            });
          }
        }
      }
    }

    return res.json({ ok: true, version: "v1-salvadoreña-original", resultados: todo });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
