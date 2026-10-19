export default async function handler(req, res) {
  const MY_SECRET = "123456";
  if (req.query.secret !== MY_SECRET) {
    return res.status(401).json({ error: 'no autorizado' });
  }
  const pageId = '112480793428483';
  const token = process.env.PAGE_TOKEN_SALVADORENO;
  if (!token) return res.json({ error: "NO HAY TOKEN en Vercel", envs: Object.keys(process.env) });
  // Probamos 2 endpoints
  const url1 = `https://graph.facebook.com/v20.0/${pageId}/feed?fields=id,message,comments.limit(10){id,message,created_time}&limit=3&access_token=${token}`;
  const r1 = await fetch(url1);
  const data1 = await r1.json();
  return res.status(200).json({
    ok: true,
    debug_feed: data1,
    token_exists: !!token,
    token_first_20: token ? token.substring(0,20) : null
  });
}
  // ... el resto igua
