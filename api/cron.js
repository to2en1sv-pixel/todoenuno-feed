module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.query.secret !== process.env.CRON_SECRET) return res.status(401).json({error:'secret malo'});
  const inicio = Date.now();
  try {
    const USER_TOKEN = (process.env.USER_TOKEN||'').trim();
    const accRes = await fetch('https://graph.facebook.com/v20.0/me/accounts?fields=id,name,access_token&limit=20&access_token='+USER_TOKEN);
    const accData = await accRes.json();
    if (accData.error) return res.json({fb_error: accData.error});

    let reporte = [];
    let borrados = [];

    // si me pasas ?page_id=123 solo revisa esa pagina
    const soloEsta = req.query.page_id;
    let paginas = accData.data || [];
    if (soloEsta) paginas = paginas.filter(p => p.id == soloEsta);

    for (const p of paginas) {
      // si ya van 8 segundos, paramos para no dar 504
      if (Date.now() - inicio > 8000) {
        reporte.push({aviso: 'se corto por tiempo, faltaron paginas'});
        break;
      }
      const fr = await fetch(`https://graph.facebook.com/v20.0/${p.id}/feed?fields=id,comments.order(reverse_chronological).limit(5){id,message,from,created_time}&limit=2&access_token=${p.access_token}`);
      const fd = await fr.json();
      const totalCom = (fd.data||[]).reduce((a,b)=>a+(b.comments?.data?.length||0),0);
      reporte.push({pagina: p.name, id: p.id, posts: fd.data?.length||0, comentarios_vistos: totalCom});

      for (const post of fd.data||[]) {
        for (const c of post.comments?.data||[]) {
          if (c.from?.id === p.id) continue;
          const haceMin = (Date.now() - new Date(c.created_time)) / 60000;
          if (haceMin > 10) continue;
          const dr = await fetch(`https://graph.facebook.com/v20.0/${c.id}?access_token=${p.access_token}`, {method:'DELETE'});
          const dj = await dr.json();
          borrados.push({pagina: p.name, comentario: c.message, fb: dj});
        }
      }
    }
    return res.json({ok:true, v:'v11-4-paginas', paginas_totales: accData.data?.length, reporte, borrados, segundos: (Date.now()-inicio)/1000});
  } catch(e){ return res.status(500).json({error:e.message}); }
};
