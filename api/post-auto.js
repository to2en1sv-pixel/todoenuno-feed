
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  // 1. Validar método y secreto
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const secret = process.env.POST_SECRET

  if (!secret || req.query.secret !== secret) {
    return res.status(401).json({ error: 'bad secret' })
  }

  // 2. Validar configuración
  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY,
    FB_PAGE_ID,
    FB_PAGE_ACCESS_TOKEN
  } = process.env

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_KEY ||
    !FB_PAGE_ID ||
    !FB_PAGE_ACCESS_TOKEN
  ) {
    return res.status(500).json({
      error: 'Faltan variables de entorno en Vercel'
    })
  }

  const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  )

  let item = null
  let phase = 'select'

  try {
    // 3. Buscar el siguiente producto pendiente
    const { data: candidates, error: selectError } =
      await supabase
        .from('post_queue')
        .select('*')
        .eq('status', 'pending')
        .order('id', { ascending: true })
        .limit(1)

    if (selectError) {
      console.error('Error leyendo la cola:', selectError)

      return res.status(500).json({
        error: 'No se pudo leer post_queue'
      })
    }

    item = candidates?.[0] ?? null

    // 4. Si no hay pendientes, reiniciar los publicados
    if (!item) {
      phase = 'reset'

      const { error: resetError } = await supabase
        .from('post_queue')
        .update({
          status: 'pending',
          fb_post_id: null,
          posted_at: null
        })
        .eq('status', 'posted')

      if (resetError) {
        console.error('Error reiniciando la cola:', resetError)

        return res.status(500).json({
          error: 'No se pudo reiniciar la cola'
        })
      }

      // Buscar nuevamente desde el ID más bajo
      const { data: first, error: firstError } =
        await supabase
          .from('post_queue')
          .select('*')
          .eq('status', 'pending')
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle()

      if (firstError) {
        console.error('Error buscando primer producto:', firstError)

        return res.status(500).json({
          error: 'No se pudo buscar el primer producto'
        })
      }

      item = first

      if (!item) {
        return res.status(200).json({
          ok: false,
          msg: 'cola vacia'
        })
      }
    }

    // 5. Validar los datos del producto
    if (!item.image_url) {
      await supabase
        .from('post_queue')
        .update({ status: 'error' })
        .eq('id', item.id)
        .eq('status', 'pending')

      return res.status(400).json({
        error: 'El producto no tiene image_url',
        id: item.id
      })
    }

    // 6. Reservar el producto antes de publicar.
    // Solo una ejecución podrá cambiar pending a posting.
    phase = 'claim'

    const { data: claimed, error: claimError } =
      await supabase
        .from('post_queue')
        .update({ status: 'posting' })
        .eq('id', item.id)
        .eq('status', 'pending')
        .select('id')

    if (claimError) {
      console.error('Error reservando producto:', claimError)

      return res.status(500).json({
        error: 'No se pudo reservar el producto',
        id: item.id
      })
    }

    if (!claimed?.length) {
      return res.status(409).json({
        ok: false,
        msg: 'El producto ya fue reservado por otra ejecución',
        id: item.id
      })
    }

    // 7. Preparar publicación
    const title = item.nombre || 'Producto Todo En Uno'

    const message =
      `${title}\n\nPide aquí: https://www.to2en1.app/shop`
        .slice(0, 900)

    // 8. Publicar la foto en Facebook
    phase = 'facebook'

    const fbRes = await fetch(
      `https://graph.facebook.com/v19.0/${FB_PAGE_ID}/photos`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: item.image_url,
          message,
          published: true,
          access_token: FB_PAGE_ACCESS_TOKEN
        }),
        signal: AbortSignal.timeout(30000)
      }
    )

    const fbData = await fbRes.json()

    if (!fbRes.ok || (!fbData.id && !fbData.post_id)) {
      console.error('Error de Meta:', {
        status: fbRes.status,
        response: fbData,
        item_id: item.id
      })

      // No volver a intentar automáticamente este producto.
      // Meta podría haber procesado una solicitud cuyo resultado
      // no se recibió correctamente; revisar antes de reintentarlo.
      const { error: markError } = await supabase
        .from('post_queue')
        .update({ status: 'error' })
        .eq('id', item.id)
        .eq('status', 'posting')

      if (markError) {
        console.error('Error guardando estado error:', markError)
      }

      return res.status(502).json({
        ok: false,
        error: 'Meta no confirmó la publicación',
        fb_status: fbRes.status,
        fb_error: fbData,
        id: item.id
      })
    }

    const finalId = fbData.post_id || fbData.id

    // 9. Guardar confirmación en Supabase
    phase = 'save'

    const { data: updated, error: updateError } =
      await supabase
        .from('post_queue')
        .update({
          status: 'posted',
          posted_at: new Date().toISOString(),
          fb_post_id: finalId
        })
        .eq('id', item.id)
        .eq('status', 'posting')
        .select('id, nombre, status, fb_post_id')

    if (updateError || !updated?.length) {
      console.error('Facebook publicó, pero Supabase no confirmó:', {
        id: item.id,
        fb_post_id: finalId,
        error: updateError
      })

      // No restablecer a pending: eso podría duplicar la publicación.
      return res.status(500).json({
        ok: false,
        error: 'Publicado en Facebook, pero falta confirmar Supabase',
        id: item.id,
        fb_post_id: finalId
      })
    }

    // 10. Resultado
    return res.status(200).json({
      ok: true,
      posted: item.id,
      nombre: title,
      fb_post_id: finalId,
      status: updated[0].status,
      message: 'Publicación realizada y guardada correctamente'
    })
  } catch (error) {
    console.error('Error inesperado:', {
      phase,
      item_id: item?.id,
      error: error instanceof Error ? error.message : String(error)
    })

    // Si el error ocurrió después de reservar el registro,
    // no lo devolvemos automáticamente a pending porque
    // no sabemos con certeza si Meta llegó a publicar.
    return res.status(500).json({
      ok: false,
      error: 'Error inesperado al procesar la publicación',
      phase,
      id: item?.id ?? null
    })
  }
}

