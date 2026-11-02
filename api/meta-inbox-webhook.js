// api/webhook-meta.js
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions'; // Requiere: npm i @vercel/functions

// ---------- Supabase ----------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY, // <-- Ajustado a tu variable exacta
  { auth: { persistSession: false } }
);

// ---------- Config Meta ----------
const GRAPH_VERSION = 'v19.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

const AUTO_DM     = process.env.FB_AUTO_DM     || '¡Gracias por tu comentario! Te escribimos por privado con la info. 💬';
const AUTO_REPLY  = process.env.FB_AUTO_REPLY  || '¡Gracias! Te enviamos un mensaje privado. 📩';

// ---------- Helpers ----------
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

async function graphDelete(path, token) {
  try {
    const res = await fetch(`${GRAPH}/${path}?access_token=${token}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) console.error(`[Graph DELETE ${path}]`, json);
    return json;
  } catch (err) {
    console.error(`[Graph DELETE ${path}] fetch error`, err);
    return {};
  }
}

function extractKeyword(text = '') {
  const clean = text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '');
  return clean.split(/\s+/)[0] || null;
}

// ---------- Lógica de negocio asíncrona ----------

async function handleFeedChange(value, page) {
  if (value.item !== 'comment' || value.verb !== 'add') return;

  const commentId = value.comment_id;
  const postId    = value.post_id;
  const from      = value.from || {};
  const message   = value.message || '';

  if (!commentId || from.id === page.page_id) return;

  const keyword = extractKeyword(message);

  // 1) Guardar lead
  const { error: leadErr } = await supabase
    .from('fb_leads')
    .upsert(
      {
        page_id:       page.page_id,
        fb_post_id:    postId,
        fb_comment_id: commentId,
        fb_user_id:    from.id,
        fb_user_name:  from.name || null,
        keyword,
        message_text:  message || null,
      },
      { onConflict: 'fb_comment_id', ignoreDuplicates: true }
    );
  if (leadErr) console.error('[lead upsert]', leadErr);

  // 2) DM privado
  const dmRes = await graphPost(`${commentId}/private_replies`, { message: AUTO_DM }, page.access_token);
  if (dmRes?.message_id) {
    // Fallback por si Graph no devuelve un ID válido
    const messageId = dmRes.message_id ? dmRes.message_id : `fallback_${crypto.randomUUID()}`;
    await supabase.from('fb_messages').upsert(
      {
        page_id:       page.page_id,
        sender_id:     from.id,
        sender_name:   from.name || null,
        message_text:  AUTO_DM,
        is_from_page:  true,
        fb_message_id: messageId,
      },
      { onConflict: 'fb_message_id', ignoreDuplicates: true }
    );
  }

  // 3) Respuesta pública
  await graphPost(`${commentId}/comments`, { message: AUTO_REPLY }, page.access_token);

  // 4) Borrar comentario
  await graphDelete(commentId, page.access_token);
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

  // 🔥 FIX 3: Fallback para msg.mid nulo o vacío (ej. stickers)
  const safeMessageId = (msg.mid && String(msg.mid).trim() !== '') 
    ? msg.mid 
    : `fallback_${crypto.randomUUID()}`;

  const { error } = await supabase
    .from('fb_messages')
    .upsert(
      {
        page_id:       page.page_id,
        sender_id:     contactId,
        sender_name:   null, // Meta no envía nombre en el webhook de messaging
        message_text:  text,
        is_from_page:  isFromPage,
        fb_message_id: safeMessageId,
      },
      { onConflict: 'fb_message_id', ignoreDuplicates: true }
    );

  if (error) console.error('[message upsert]', error);
}

// ---------- Procesador en Background ----------
async function processPayload(body) {
  try {
    if (body?.object !== 'page') return;

    for (const entry of body.entry || []) {
      const pageId = entry.id;

      // Obtener token de la página
      const { data: page, error } = await supabase
        .from('fb_pages')
        .select('page_id, page_name, access_token')
        .eq('page_id', pageId)
        .maybeSingle();

      if (error || !page) {
        console.warn(`[webhook] Sin token para la página ${pageId}`);
        continue; // Pasa a la siguiente página
      }

      // Comentarios
      for (const change of entry.changes || []) {
        if (change.field === 'feed') {
          await handleFeedChange(change.value, page).catch(e => console.error('[feed]', e));
        }
      }

      // Mensajes / DMs
      for (const evt of entry.messaging || []) {
        await handleMessaging(evt, page).catch(e => console.error('[messaging]', e));
      }
    }
  } catch (err) {
    console.error('[webhook] Error fatal procesando payload', err);
  }
}

// ---------- Entry point ----------
export default async function handler(req, res) {
  // === GET: Verificación de Meta ===
  if (req.method === 'GET') {
    const query = req.query || {};
    const mode      = query['hub.mode'];
    const token     = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token && token === process.env.FB_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  // === POST: Recibir eventos ===
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody   = await getRawBody(req);
  const signature = req.headers['x-hub-signature-256'];

  if (!verifySignature(rawBody, signature)) {
    console.warn('[webhook] Firma inválida');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let body;
  try { body = JSON.parse(rawBody); } catch { body = req.body; }

  // 🔥 FIX 1: Responder a Meta inmediatamente y procesar en background
  try {
    // waitUntil mantiene la lambda viva hasta que la promesa termine,
    // pero el res.status(200) se envía YA.
    waitUntil(processPayload(body));
  } catch (e) {
    // Si waitUntil falla por alguna razón, disparamos sin esperar
    void processPayload(body);
  }

  return res.status(200).send('EVENT_RECEIVED');
}
