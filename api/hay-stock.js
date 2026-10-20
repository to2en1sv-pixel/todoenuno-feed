module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  
  if (req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'secret incorrecto' });
  }

  const sku = (req.query.sku || '').trim();
  if (!sku) return res.status(400).json({ error: 'falta ?sku=' });

  try {
    const ODOO_URL = process.env.ODOO_URL;
    const ODOO_DB = process.env.ODOO_DB;
    const ODOO_USER = process.env.ODOO_USER;
    const ODOO_PASS = process.env.ODOO_PASSWORD;

    if (!ODOO_URL || !ODOO_DB) {
      return res.json({ sku, hay: true, stock: 999, fuente: 'sin-odoo-configurado' });
    }

    // 1. Autenticar
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

    // 2. Buscar por Referencia, Codigo de barras O Nombre - CORREGIDO
    const domain = [
      '|','|',
      ['default_code','ilike', sku],
      ['barcode','=', sku],
      ['name','ilike', sku]
    ];

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
            [domain],
            { fields: ['qty_available','name','default_code','barcode'], limit: 1 }
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
      referencia: producto.default_code,
      stock, 
      hay: stock > 0,
      mensaje: stock > 0 ? `Quedan ${stock}` : 'Sin stock'
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
