module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.query.secret !== process.env.CRON_SECRET) return res.status(401).json({error:'mal secret'});
  try {
    const USER_TOKEN = (process.env.USER_TOKEN||'').trim();
    const accRes = await fetch('https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&limit=20&access_token='+USER_TOKEN);
    const accData = await accRes.json();
    if (accData.error) return res.json(accData);
    
    let paginas = accData.data || [];
    if (paginas.length === 0) return res.json({error:'no hay paginas, revisa USER_TOKEN'});

    // Si me mandas ?page_id= lo uso, si no roto automaticamente
    let target;
    if (req.query.page_id) {
      target = paginas.find(p => p.id == req.query.page_id);
    } else {
      // rota por minuto: minuto 0= pag 0, minuto 1= pag 1, etc
      const idx = new Date().getMinutes() % paginas.length;
      target = paginas[idx];
    }

    if (!target) return res.json({error:'page_id no encontrado', paginas: paginas.map(p=>({id:p.id, name:p.name}))});

    const fr = await fetch(`https://graph.facebook.com/v20.0/${target.id}/feed?fields=id,comments.order(reverse_chronological).limit(10){id,message,from,created_time}&limit=3&access_token=${target.access_token}`);
    const fd = await fr.json();

    let borrados = [];
    for (const post of fd.data||[]) {
      for (const c of post.comments?.data||[]) {
        if (c.from?.id === target.id) continue;
        const haceMin = (Date.now() - new Date(c.created_time)) / 60000;
        if (haceMin > 15) continue; // 15 min de ventana
        const dr = await fetch(`https://graph.facebook.com/v20.0/${c.id}?access_token=${target.access_token}`, {method:'DELETE'});
        const dj = await dr.json();
        borrados.push({pagina: target.name, comentario: c.message, resp: dj});
      }
    }
    return res.json({ok:true, v:'v12-rotativo', revisando: target.name, id: target.id, paginas_totales: paginas.length, borrados});
  } catch(e){ return res.status(500).json({error:e.message}); }
};
