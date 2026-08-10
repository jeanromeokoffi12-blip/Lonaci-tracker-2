const crypto = require('crypto');

app.post('/api/activer-code', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ valid: false, message: "Code manquant" });

  const { data: existant, error } = await supabase
    .from('access_codes')
    .select('*')
    .eq('code', code)
    .single();

  if (error || !existant) {
    return res.json({ valid: false, message: "Code invalide" });
  }

  if (!existant.token) {
    const nouveauToken = crypto.randomBytes(24).toString('hex');
    await supabase
      .from('access_codes')
      .update({ token: nouveauToken, date_activation: new Date().toISOString() })
      .eq('code', code);
    return res.json({ valid: true, token: nouveauToken, premiere_activation: true });
  }

  return res.json({ valid: true, deja_active: true });
});

app.post('/api/verifier-token', async (req, res) => {
  const { code, token } = req.body;
  if (!code || !token) return res.status(400).json({ valid: false });

  const { data, error } = await supabase
    .from('access_codes')
    .select('token')
    .eq('code', code)
    .single();

  if (error || !data) return res.json({ valid: false });
  return res.json({ valid: data.token === token });
});
