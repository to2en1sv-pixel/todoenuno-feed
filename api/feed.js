
const fetch = require('node-fetch');
const cheerio = require('cheerio');

module.exports = async (req, res) => {
  try {
    const shopUrl = 'https://www.to2en1.app/shop';
    const response = await fetch(shopUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await response.text();
    const $ = cheerio.load(html);
    
    let products = [];
    let id = 1;
    
    // Odoo shop structure - busca productos
    $('.oe_product, [data-oe-model="product.template"]').each((i, el) => {
      const name = $(el).find('.o_product_name, h6, .product_name').first().text().trim() || $(el).find('a strong, a h6').first().text().trim();
      const priceText = $(el).find('.oe_currency_value, .product_price').first().text().trim();
      const img = $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src');
      if (name) {
        const price = parseFloat(priceText.replace(/[^0-9.,]/g,'').replace(',','.')) || 10;
        products.push({ id, name: name.substring(0,140), price, img });
        id++;
      }
    });
    
    // Fallback: si no encuentra con clase, parsea texto como lo hicimos
    if (products.length === 0) {
      const lines = html.split('\n');
      let currentName = '';
      for (let line of lines) {
        const clean = line.replace(/<[^>]*>/g,'').trim();
        if (clean.startsWith('######')) {
          currentName = clean.replace('######','').trim();
        } else if (clean.startsWith('$') && currentName) {
          const price = parseFloat(clean.replace(/[^0-9.]/g,'')) || 10;
          products.push({ id, name: currentName.substring(0,140), price, img: '' });
          currentName = '';
          id++;
        }
      }
    }

    // Generar CSV para Meta
    const headers = ['id','title','description','availability','condition','price','link','image_link','brand','product_type','google_product_category'];
    let csv = headers.join(',') + '\n';
    
    for (let p of products) {
      const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g,'-').substring(0,50);
      const imageLink = p.img ? (p.img.startsWith('http') ? p.img : 'https://www.to2en1.app' + p.img) : `https://www.to2en1.app/web/image/product.template/${p.id}/image_1024`;
      const row = [
        `to2en1_${p.id}`,
        `"${p.name.replace(/"/g,'""')}"`,
        `"${p.name} - Disponible en to2en1.app con pago contra entrega 24-72h SV, devolucion 30 dias."`,
        'in stock',
        'new',
        `${p.price.toFixed(2)} USD`,
        `https://www.to2en1.app/shop/${slug}-${p.id}`,
        imageLink,
        'to2en1.app',
        'Todo en Uno',
        'Home & Garden'
      ];
      csv += row.join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate'); // 6 horas
    res.setHeader('Content-Disposition', 'inline; filename=facebook.csv');
    res.status(200).send(csv);
    
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
};
