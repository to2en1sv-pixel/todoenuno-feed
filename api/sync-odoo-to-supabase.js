import { createClient } from '@supabase/supabase-js';

// Usa las mismas env de Odoo que tu /api/hay-stock
const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_USER = process.env.ODOO_USER;
const ODOO_PASSWORD = process.env.ODOO_PASSWORD;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function odooCall(model, method, args = [], kwargs = {}) {
  const authRes = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'common',
        method: 'authenticate',
        args: [ODOO_DB, ODOO_USER, ODOO_PASSWORD, {}]
      },
      id: 1
    })
  });
  const authData = await authRes.json();
  const uid = authData.result;

  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [ODOO_DB, uid, ODOO_PASSWORD, model, method, args, kwargs]
      },
      id: 2
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result;
}

export default async function handler(req, res) {
  if (req.query.secret !== '123456') return res.status(401).json({ error: 'unauthorized' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  try {
    // 1. Trae todas las variantes activas que se pueden vender
    const variantes = await odooCall('product.product', 'search_read', 
      [[['sale_ok', '=', true]]],
      { fields: ['id', 'display_name', 'product_tmpl_id', 'default_code', 'qty_available', 'list_price', 'active'] }
    );

    // 2. Trae info del template para saber si está publicado en web
    const templateIds = [...new Set(variantes.map(v => v.product_tmpl_id[0]))];
    const templates = await odooCall('product.template', 'search_read',
      [[['id', 'in', templateIds]]],
      { fields: ['id', 'name', 'website_published', 'active'] }
    );
    const templateMap = Object.fromEntries(templates.map(t => [t.id, t]));

    let upsertCount = 0;
    for (const v of variantes) {
      const tmpl = templateMap[v.product_tmpl_id[0]];
      if (!tmpl) continue;

      // Extrae color y talla del display_name: "Moisés (Color: Celeste, Talla: M)"
      let color = 'Unica';
      let talla = 'Unica';
      const match = v.display_name.match(/Color:\s*([^,\)]+).*Talla:\s*([^,\)]+)/i);
      if (match) {
        color = match[1].trim();
        talla = match[2].trim();
      } else if (v.display_name.toLowerCase().includes('celeste')) {
        color = 'Celeste';
      }

      // LÓGICA ESPECIAL QUE PEDISTE
      let estado = 'NO_DISPONIBLE';
      let es_test = false;
      if (!v.active || !tmpl.active || !tmpl.website_published) {
        estado = 'NO_DISPONIBLE';
      } else if (v.qty_available > 0) {
        estado = 'DISPONIBLE';
      } else {
        estado = 'TEST'; // Publicado en web, sin stock contable -> para tu testeo
        es_test = true;
      }

      // Upsert template
      await supabase.from('productos').upsert({
        template_id: tmpl.id,
        nombre_base: tmpl.name,
        is_published: tmpl.website_published,
        active: tmpl.active
      });

      // Upsert variante
      await supabase.from('productos_variantes').upsert({
        variante_id: v.id,
        template_id: tmpl.id,
        sku: v.default_code || v.display_name.toLowerCase().replace(/\s+/g, '-'),
        nombre_completo: v.display_name,
        color: color,
        talla: talla,
        stock: v.qty_available,
        precio: v.list_price,
        estado: estado,
        es_test: es_test,
        updated_at: new Date().toISOString()
      });
      upsertCount++;
    }

    return res.status(200).json({ ok: true, synced: upsertCount, estado_logica: 'DISPONIBLE/TEST/NO_DISPONIBLE aplicada' });

  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
