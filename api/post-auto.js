// /api/post-auto.js - Vercel Pages Router - FIX FEED + CAPTION
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.query.secret !== process.env.POST_SECRET) {
    return res.status(401).json({ error: 'bad secret' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  
  // 1. Toma 1 pendiente con imagen pública de Supabase
  const { data: item, error: qError } = await supabase
    .from('post_queue')
    .select('*')
    .eq('status','pending')
    .order('priority',{ascending:false})
    .limit(1)
    .maybeSingle()

  if (qError) return res.status(500).json({ ok: false, error: qError.message })
  if (!item) return res.json({ ok: false, msg: 'no pending' })

  // 2. Armar caption sin undefined
  const title = item.product_name || item.name || item.title || 'Producto Todo En Uno'
  const desc = item.description || item.product_description || ''
  const price = item.price ? `Precio: $${item.price}\n` : ''
  const message = `${title}\n\n${desc}\n\n${price}Comenta YO para info 👇\nPide aquí: www.to2en1.app/shop`.slice(0, 900)

  // 3. Post a FB - FORZADO A FEED
  const fbRes = await fetch(`https://graph.facebook.com/v19.0/${process.env.FB_PAGE_ID}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: item.image_url, // debe ser https://xxx.supabase.co/storage/... PUBLICO
      message: message, // <-- en /photos se usa message, no caption
      published: true, // <-- CLAVE: hace que aparezca en Timeline
      access_token: process.env.FB_PAGE_ACCESS_TOKEN
    })
  })
  
  const fbData = await fbRes.json()
  
  if (fbData.id || fbData.post_id) {
    const finalId = fbData.post_id || fbData.id
    await supabase.from('post_queue').update({ 
      status: 'posted', 
      posted_at: new Date().toISOString(), 
      fb_post_id: finalId,
      fb_response: fbData
    }).eq('id', item.id)
    
    return res.json({ ok: true, fb_post_id: finalId, fb_data: fbData })
  } else {
    await supabase.from('post_queue').update({ 
      status: 'error', 
      fb_response: fbData 
    }).eq('id', item.id)
    return res.status(500).json({ ok: false, fb_error: fbData, tried_image: item.image_url })
  }
}
