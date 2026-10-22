// /api/post-auto.js - CON ROTACION CIRCULAR ANTI-REPETICION
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.query.secret !== process.env.POST_SECRET) {
    return res.status(401).json({ error: 'bad secret' })
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

  // 1. Busca el siguiente pendiente en orden
  let { data: item } = await supabase
    .from('post_queue')
    .select('*')
    .eq('status','pending')
    .is('fb_post_id', null)
    .order('id',{ascending:true})
    .limit(1)
    .maybeSingle()

  // 2. Si no hay pendientes, REINICIA LA ROTACION
  if (!item) {
    await supabase.from('post_queue').update({ 
      status: 'pending', 
      fb_post_id: null, 
      posted_at: null,
      fb_response: null 
    }).eq('status','posted')
    
    const { data: first } = await supabase
      .from('post_queue')
      .select('*')
      .eq('status','pending')
      .order('id',{ascending:true})
      .limit(1)
      .maybeSingle()
    
    item = first
    if (!item) return res.json({ ok: false, msg: 'cola vacia, reseteada' })
  }

  const title = item.product_name || 'Producto Todo En Uno'
  const desc = item.description || ''
  const price = item.price ? `Precio: $${item.price}\n` : ''
  const message = `${title}\n\n${desc}\n\n${price}Pide aquí: www.to2en1.app/shop`.slice(0, 900)

  const fbRes = await fetch(`https://graph.facebook.com/v19.0/${process.env.FB_PAGE_ID}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: item.image_url,
      message,
      published: true,
      access_token: process.env.FB_PAGE_ACCESS_TOKEN
    })
  })
  
  const fbData = await fbRes.json()
  if (!fbData.id && !fbData.post_id) {
    await supabase.from('post_queue').update({ status: 'error', fb_response: fbData }).eq('id', item.id)
    return res.status(500).json({ ok: false, fb_error: fbData, item_id: item.id })
  }

  const finalId = fbData.post_id || fbData.id
  
  // 3. Marca como posted - EN OTRA TRANSACCION SEPARADA
  const { error: upError } = await supabase.from('post_queue').update({ 
    status: 'posted', 
    posted_at: new Date().toISOString(), 
    fb_post_id: finalId,
    fb_response: fbData
  }).eq('id', item.id)

  if (upError) {
    return res.status(500).json({ ok: false, step: 'update', fb_post_id: finalId, update_error: upError.message })
  }

  return res.json({ ok: true, rotated: true, item_id: item.id, title, fb_post_id: finalId })
}
