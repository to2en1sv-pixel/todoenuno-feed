// api/meta-inbox-webhook.js
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions'; // Requiere: npm i @vercel/functions

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY, 
  { auth: { persistSession: false } }
);

const GRAPH_VERSION = 'v19.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

function getRawBody(req) {
  if (typeof req.body === 'string') return Promise.resolve(req.body);
  if (Buffer.isBuffer(req.body))    return Promise.resolve(req.body.toString('utf8'));
  if (req.body && typeof req.body === 'object') return Promise.resolve(JSON.stringify(req.body));
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

function verifySignature(rawBody, signature) {
  const secret = process.env.FB_APP_SECRET;
  if (!secret || !signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(signature, 'utf8'));
  } catch { return false; }
}

async function graphPost(path, body, token) {
  try {
    const res = await fetch(`${GRAPH}/${path}?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) console.error(`[Graph POST ${path}]`, json);
    return json;
  } catch (err) {
    console.error(`[Graph POST ${path}] fetch error`, err);
    return {};
  }
}

function extractKeyword(text = '') {
  const clean = text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '');
  return clean.split(/\s+/)[0] || null;
}

async function handleFeedChange(value, page) {
  if (value.item !== 'comment' || value.verb !== 'add') return;

  const commentId = value.comment_id;
  const postId    = value.post_id;
  const from      = value.from || {};
  const message   = value.message || '';

  if (!commentId || from.id === page.page_id) return;

  const messageLower = message.toLowerCase();
  const nombreCliente = from.name || 'amigo';

  // ==========================================
  // 🛑 1. FILTRO ANTI-SPAM (Ocultar comentario)
  // ==========================================
  const spamKeywords = ['vendo', 'venta', 'mayorista', 'distribuidor', 'barato', 'http', 'www', '.com', 'tengo stock', 'al por mayor'];
  const esSpam = spamKeywords.some(k => messageLower.includes(k));

  if (esSpam) {
    console.log(`[feed] 🛑 SPAM DETECTADO de ${nombreCliente}: "${message}". Ocultando...`);
    // Ocultamos el comentario para que nadie más lo vea
    await graphPost(commentId, { is_hidden: true }, page.access_token);
    return; // Terminamos aquí, no enviamos DM ni nada más
  }

  // ==========================================
  // 🛒 2. FILTRO DE INTENCIÓN DE COMPRA
  // ==========================================
  const buyerKeywords = ['info', 'yo', 'precio', 'cuanto', 'disponible', 'comprar', 'quiero', 'talla', 'color'];
  const tieneIntencion = buyerKeywords.some(k => messageLower.includes(k));

  if (!tieneIntencion) {
    console.log(`[feed] 💬 Comentario ignorado (sin intención de compra): "${message}"`);
    return; // Si no es spam ni quiere comprar, lo dejamos visible tranquilamente
  }

  // ==========================================
  // 🚀 3. FLUJO DE VENTAS (Cliente Interesado)
  // ==========================================
  const keyword = extractKeyword(message);

  // A. Guardar Lead en Supabase
  const { error: leadErr } = await supabase.from('fb_leads').upsert({
    page_id:       page.page_id,
    fb_post_id:    postId,
    fb_comment_id: commentId,
    fb_user_id:    from.id,
    fb_user_name:  from.name || null,
    keyword,
    message_text:  message || null,
  }, { onConflict: 'fb_comment_id', ignoreDuplicates: true });
  
  if (leadErr) console.error('[lead upsert]', leadErr);

  // B. Mensajes Personalizados
  const mensajeDM = `¡Hola ${nombreCliente}! 👋 Gracias por tu interés.\n\n🛍️ Puedes ver nuestro catálogo completo aquí: https://www.to2en1.app/shop\n\n💬 Si prefieres atención personalizada, escríbenos directo a nuestro WhatsApp: https://wa.me/50369906524\n\n¡Quedamos atentos!`;
  
  const mensajePublico = `¡Gracias ${nombreCliente}! Te enviamos toda la información por privado 📩. Revisa tus mensajes.`;

  // C. Enviar DM privado
  const dmRes = await graphPost(`${commentId}/private_replies`, { message: mensajeDM }, page.access_token);
  if (dmRes?.message_id) {
    const messageId = dmRes.message_id ? dmRes.message_id : `fallback_${crypto.randomUUID()}`;
    await supabase.from('fb_messages').upsert({
      page_id: page.page_id, sender_id: from.id, sender_name: from.name || null,
      message_text: mensajeDM, is_from_page: true, fb_message_id: messageId,
    }, { onConflict: 'fb_message_id', ignoreDuplicates: true });
  }

  // D. Responder públicamente
  await graphPost(`${commentId}/comments`, { message: mensajePublico }, page.access_token);
  
  // E. Ocultar el comentario original (En lugar de borrarlo)
  // Así el cliente ve su comentario y tu respuesta, pero el resto del mundo no.
  await graphPost(commentId, { is_hidden: true }, page.access_token);
  console.log(`[feed] ✅ Comentario de ${nombreCliente} atendido y ocultado.`);
}

async function handleMessaging(event, page) {
  const msg = event.message;
  if (!msg) return;
  if (!msg.text && !msg.attachments) return;

  const senderId    = event.sender?.id;
  const recipientId = event.recipient?.id;
  if (!senderId) return;

  const isFromPage = senderId === page.page_id;
  const contactId  = isFromPage ? recipientId : senderId;
  const text = msg.text || (msg.attachments ? '[adjunto]' : '');
  if (!text) return;

  const safeMessageId = (msg.mid && String(msg.mid).trim() !== '') ? msg.mid : `fallback_${crypto.randomUUID()}`;

  const { error } = await supabase.from('fb_messages').upsert({
    page_id: page.page_id, sender_id: contactId, sender_name: null,
    message_text: text, is_from_page: isFromPage, fb_message_id: safeMessageId,
  }, { onConflict: 'fb_message_id', ignoreDuplicates: true });

  if (error) console.error('[message upsert]', error);
}

async function processPayload(body) {
  try {
    if (body?.object !== 'page') return;
    for (const entry of body.entry || []) {
      const { data: page, error } = await supabase.from('fb_pages').select('*').eq('page_id', entry.id).maybeSingle();
      if (error || !page) {
        console.warn(`[webhook] Sin token para la página ${entry.id}`);
        continue;
      }

      for (const change of entry.changes || []) {
        if (change.field === 'feed') await handleFeedChange(change.value, page).catch(e => console.error('[feed]', e));
      }
      for (const evt of entry.messaging || []) {
        await handleMessaging(evt, page).catch(e => console.error('[messaging]', e));
      }
    }
  } catch (err) { 
    console.error('[webhook] Error fatal', err); 
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query || {};
    if (mode === 'subscribe' && token === process.env.FB_VERIFY_TOKEN) {
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(String(challenge));
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const rawBody = await getRawBody(req);
  const signature = req.headers['x-hub-signature-256'];

  // ⚠️ ATENCIÓN: FIRMA TEMPORALMENTE DESACTIVADA PARA PRUEBAS
  // Cuando todo esté listo para producción, cambia "if (false &&..." por "if ("
  if (false && !verifySignature(rawBody, signature)) {
    console.warn('[webhook] Firma inválida');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let body;
  try { body = JSON.parse(rawBody); } catch { body = req.body; }

  try { 
    waitUntil(processPayload(body)); 
  } catch { 
    void processPayload(body); 
  }
  
  return res.status(200).send('EVENT_RECEIVED');
}
