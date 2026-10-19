module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  
  // Seguridad para que solo Builderbot lo use
  if (req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'secret incorrecto' });
  }

  const sku = (req.query.sku || '').trim();
  if (!sku) return res.status(400).json({ error: 'falta ?sku=to2en1_34' });

  try {
    const ODOO_URL = process.env.ODOO_URL; // ej: https://to2en1.odoo.com
    const ODOO_DB = process.env.ODOO_DB;
    const ODOO_USER = process.env.ODOO_USER;
    const ODOO_PASS = process.env.ODOO_PASSWORD;

    if (!ODOO_URL || !ODOO_DB) {
      return res.json({ sku, hay: true, stock: 999, fuente: 'sin-odoo-configurado', nota: 'Configura ODOO_URL en Vercel para validacion real' });
    }

    // 1. Autenticar en Odoo
    const authRes = await fetch(`${ODOO_URL}/jsonrpc`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: { service: "common", method: "authenticate", args: [ODOO_DB, ODOO_USER, ODOO_PASS, {}] },
        id: 1
      })
    });
    const authData = await authRes.json();
    const uid = authData.result;
    if (!uid) return res.json({ sku, hay: false, error: 'No auth Odoo', detalle: authData });

    // 2. Buscar producto por SKU (default_code)
    const searchRes = await fetch(`${ODOO_URL}/jsonrpc`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: {
          service: "object",
          method: "execute_kw",
          args: [ODOO_DB, uid, ODOO_PASS, 'product.product', 'search_read',
            [[['default_code','=',sku]]],
            { fields: ['qty_available','name'], limit: 1 }
          ]
        },
        id: 2
      })
    });
    const searchData = await searchRes.json();
    const producto = searchData.result?.[0];

    if (!producto) {
      return res.json({ sku, hay: false, stock: 0, mensaje: 'SKU no existe en Odoo' });
    }

    const stock = producto.qty_available || 0;
    return res.json({ 
      sku, 
      nombre: producto.name,
      stock, 
      hay: stock > 0,
      mensaje: stock > 0 ? `Quedan ${stock}` : 'Sin stock'
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
