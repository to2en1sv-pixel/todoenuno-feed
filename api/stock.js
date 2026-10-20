import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL, // https://trgywmhxmkbjfcdvxpnz.supabase.co
  process.env.SUPABASE_SERVICE_KEY
)

export default async function handler(req, res) {
  const { sku, q } = req.query

  // Búsqueda por texto para Builderbot: /api/stock?q=bocina
  if (q) {
    const { data, error } = await supabase
      .from('productos_variantes')
      .select(`
        sku, nombre_variante, talla, color, qty, precio,
        productos!inner(nombre_base, categoria, is_published)
      `)
      .ilike('nombre_variante', `%${q}%`)
      .eq('productos.is_published', true)
      .limit(20)

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ ok: true, results: data })
  }

  // Consulta exacta por SKU: /api/stock?sku=X-312-AZUL
  if (!sku) return res.status(400).json({ error: 'Falta ?sku= o ?q=' })

  const { data: variante } = await supabase
    .from('productos_variantes')
    .select('*')
    .eq('sku', sku)
    .single()

  const { data: cache } = await supabase
    .from('inventory_cache')
    .select('qty, state, updated_at')
    .eq('sku', sku)
    .single()

  if (!variante) return res.status(404).json({ ok: false, msg: 'SKU no encontrado' })

  // Lógica de estados que ya sincronizaste
  const stockReal = cache?.qty ?? variante.qty
  let mensaje = 'DISPONIBLE'
  if (cache?.state === 'NO_DISPONIBLE' || stockReal <= 0) mensaje = 'NO_DISPONIBLE'
  else if (cache?.state === 'TEST') mensaje = 'TEST - Preguntar en bodega'
  
  return res.json({
    ok: true,
    sku,
    nombre: variante.nombre_variante,
    qty: stockReal,
    state: cache?.state || 'DISPONIBLE',
    estado_mensaje: mensaje,
    precio: variante.precio,
    talla: variante.talla,
    color: variante.color,
    actualizado: cache?.updated_at
  })
}
