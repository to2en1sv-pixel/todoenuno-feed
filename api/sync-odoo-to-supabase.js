import { createClient } from '@supabase/supabase-js';

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_USER = process.env.ODOO_USER;
const ODOO_PASSWORD = process.env.ODOO_PASSWORD;

async function odooCall(model, method, args = [], kwargs = {}) {
  const authRes = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc:'2.0', method:'call', params:{ service:'common', method:'authenticate', args:[ODOO_DB, ODOO_USER, ODOO_PASSWORD, {}] }, id:1 })
  });
  const uid = (await authRes.json()).result;
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method:'POST', headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify({ jsonrpc:'2.0', method:'call', params:{ service:'object', method:'execute_kw', args:[ODOO_DB, uid, ODOO_PASSWORD, model, method, args, kwargs] }, id:2 })
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return data.result;
}

export default async function handler(req, res) {
  if (req.query.secret !== '123456') return res.status(401).json({ error:'unauthorized' });
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  try {
    const variantes = await odooCall('product.product', 'search_read', [[['sale_ok','=',true]]], { fields:['id','display_name','product_tmpl_id','default_code','qty_available','list_price','active'] });
    const templateIds = [...new Set(variantes.map(v=>v.product_tmpl_id[0]))];
    const templates = await odooCall('product.template', 'search_read', [[['id','in',templateIds]]], { fields:['id','name','website_published','active'] });
    const templateMap = Object.fromEntries(templates.map(t=>[t.id,t]));

    let ok=0, errors=[];
    for (const v of variantes) {
      const tmpl = templateMap[v.product_tmpl_id[0]]; if(!tmpl) continue;
      let color='Unica', talla='Unica';
      const m=v.display_name.match(/Color:\s*([^,\)]+).*Talla:\s*([^,\)]+)/i);
      if(m){ color=m[1].trim(); talla=m[2].trim(); }

      const estado = (!v.active || !tmpl.active || !tmpl.website_published) ? 'NO_DISPONIBLE' : (v.qty_available>0 ? 'DISPONIBLE' : 'TEST');

      const {error:e1} = await supabase.from('productos').upsert({ template_id: tmpl.id, nombre_base: tmpl.name, is_published: tmpl.website_published, active: tmpl.active }, {onConflict:'template_id'});
      if(e1) errors.push({fase:'producto', id:tmpl.id, error:e1});

      const {error:e2} = await supabase.from('productos_variantes').upsert({
        variante_id:v.id, template_id:tmpl.id, sku:v.default_code||v.display_name.toLowerCase().replace(/\s+/g,'-'), nombre_completo:v.display_name,
        color, talla, stock:v.qty_available, precio:v.list_price, estado, es_test: estado==='TEST', updated_at:new Date().toISOString()
      }, {onConflict:'variante_id'});
      if(e2) errors.push({fase:'variante', id:v.id, error:e2}); else ok++;
    }
    return res.status(200).json({ ok:true, synced:ok, total_leido:variantes.length, supabase_errors:errors.slice(0,5), supabase_url:process.env.SUPABASE_URL });

  } catch(e){ return res.status(500).json({ error:e.message, stack:e.stack }); }
}
