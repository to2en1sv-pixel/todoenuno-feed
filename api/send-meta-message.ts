// api/send-meta-message.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
});

const GRAPH_VERSION = 'v19.0';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { pageId, recipientId, text } = (req.body || {}) as {
    pageId?: string;
    recipientId?: string;
    text?: string;
  };

  if (!pageId || !recipientId || !text || !text.trim()) {
    return res.status(400).json({ error: 'pageId, recipientId y text son obligatorios' });
  }

  // 1) Obtener el token de la página desde Supabase
  const { data: page, error } = await supabase
    .from('fb_pages')
    .select('page_id, access_token')
    .eq('page_id', pageId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!page) return res.status(404).json({ error: `Página ${pageId} no encontrada` });

  // 2) Enviar por Messenger / Instagram
  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/messages?access_token=${page.access_token}`;
    const graphRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: 'RESPONSE',
        message: { text },
      }),
    });

    const data = await graphRes.json().catch(() => ({}));

    if (!graphRes.ok) {
      return res.status(graphRes.status).json({
        error: data?.error?.message || 'Error de Meta Graph API',
        detail: data,
      });
    }

    // 3) Guardar el mensaje saliente en la BD
    if (data?.message_id) {
      await supabase.from('fb_messages').upsert(
        {
          page_id:       pageId,
          sender_id:     recipientId,
          message_text:  text.trim(),
          is_from_page:  true,
          fb_message_id: data.message_id,
        },
        { onConflict: 'fb_message_id', ignoreDuplicates: true }
      );
    }

    return res.status(200).json({ ok: true, message_id: data.message_id });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Error enviando mensaje' });
  }
}
