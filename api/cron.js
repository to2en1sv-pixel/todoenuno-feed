module.exports = async (req, res) => {
  if (req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'secret incorrecto' });
  }

  try {
    const USER_TOKEN = (process.env.USER_TOKEN || '').trim();
    const accRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&limit=100&access_token=${USER_TOKEN}`);
    const accData = await accRes.json();
    if (accData.error) return res.json(accData);

    let borrados = [];

    for (const page of (accData.data || [])) {
      const token = page.access_token;
      
      // 10 posts más recientes
      const feedRes = await fetch(`https://graph.facebook.com/v20.0/${page.id}/feed?fields=id,comments.order(reverse_chronological).limit(20){id,message,from,created_time}&limit=10&access_token=${token}`);
      const feedData = await feedRes.json();

      for (const post of (feedData.data || [])) {
        for (const c of (post.comments?.data || [])) {
          if (!c.message) continue;
          // que no sea comentario de la misma página
          if (c.from?.id === page.id) continue;

          const haceMin = (Date.now() - new Date(c.created_time).getTime()) / 60000;
          if (haceMin > 10) continue; // solo nuevos

          // BORRAR
          const delRes = await fetch(`https://graph.facebook.com/v20.0/${c.id}?access_token=${token}`, {
            method: 'DELETE'
          });
          const delData = await delRes.json();
          borrados.push({ comentario: c.message, resultado: delData });
        }
      }
    }

    return res.json({ ok: true, version: "v4-BORRAR-TODO", borrados });

  } catch (e) {
    return res.json({ error: e.message });
  }
};
    return res.status(500).json({ error: e.message });
  }
};
