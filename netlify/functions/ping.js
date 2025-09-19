exports.handler = async () => {
  const mask = (v) => (v ? 'set' : 'missing');
  return {
    statusCode: 200,
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      ok: true,
      env: {
        SUPABASE_URL: mask(process.env.SUPABASE_URL),
        SUPABASE_ANON_KEY: mask(process.env.SUPABASE_ANON_KEY),
        SITE_URL: process.env.SITE_URL || null
      }
    })
  };
};
