module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.query.secret !== process.env.CRON_SECRET) return res.status(401).json({error:'secret malo'});
  try {
    const USER_TOKEN = (process.env.USER_TOKEN||'').trim();
    const accRes = await fetch('https://graph.facebook.com/v20.0/me/accounts?fields=id,access_token&limit=10&access_token='+USER_TOKEN);
    const accData = await accRes.json();
    let borrados=[];
    for (const p of accData.data||[]) {
      const fr = await fetch('https://graph.facebook.com/v20.0/'+p.id+'/feed?fields=comments.limit(5){id,from,created_time}&limit=3&access_token='+p.access_token);
      const fd = await fr.json();
      for (const post of fd.data||[]) {
        for (const c of post.comments?.data||[]) {
          if (c.from?.id===p.id) continue;
          if ((Date.now()-new Date(c.created_time))/60000>10) continue;
          const dr = await fetch('https://graph.facebook.com/v20.0/'+c.id+'?access_token='+p.access_token,{method:'DELETE'});
          borrados.push(await dr.json());
        }
      }
    }
    return res.json({ok:true,borrados});
  } catch(e){ return res.status(500).json({error:e.message}); }
};
