// /api/post-auto.js - Vercel Pages Router
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.query.secret !== process.env.POST_SECRET) {
    return res.status(401).json({ error: 'bad secret' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  
  // 1. Toma 1 pendiente con imagen pública de Supabase
  const { data: item } = await supabase.from('post_queue').select('*').eq('status','pending').order('priority',{ascending:false}).limit(1).single()
  if (!item) return res.json({ ok: false, msg: 'no pending' })

  // 2. Post a FB con Page Token ETERNO
  const fbRes = await fetch(`https://graph.facebook.com/v19.0/${process.env.FB_PAGE_ID}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: item.image_url, // debe ser https://xxx.supabase.co/storage/... (no Odoo)
      caption: `${item.title} - ${item.description}\nComenta YO para info`,
      access_token: process.env.FB_PAGE_ACCESS_TOKEN // el que dice Nunca
    })
  })
  const fbData = await fbRes.json()
  
  if (fbData.id) {
    await supabase.from('post_queue').update({ status: 'posted', posted_at: new Date().toISOString(), fb_post_id: fbData.id }).eq('id', item.id)
    return res.json({ ok: true, fb_post_id: fbData.id })
  } else {
    return res.status(500).json({ ok: false, fb_error: fbData })
  }
}
