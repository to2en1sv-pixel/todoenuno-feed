module.exports = async (req, res) => {
  if (req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'secret malo' });
  }
  return res.json({ ok: true, msg: 'deploy funciona', hora: new Date().toISOString() });
};
