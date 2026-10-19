export default function handler(req, res) {
  const VERIFY_TOKEN = "to2en1_secreto_123";
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    } else {
      return res.status(403).send('Token no coincide');
    }
  }
  if (req.method === 'POST') {
    console.log('COMENTARIO:', JSON.stringify(req.body, null, 2));
    return res.status(200).send('EVENT_RECEIVED');
  }
}
