// Vercel function: forwards read-only requests to ESPN's fantasy API.
// Browsers can't send ESPN login cookies cross-origin, so private leagues need this hop.
// The espn_s2 / SWID cookies arrive in request headers, are used for this one request,
// and are never stored or logged.
const HOST = 'https://lm-api-reads.fantasy.espn.com';
const PATH_OK = /^\/apis\/v3\/games\/ffl\/seasons\/\d{4}\/segments\/0\/leagues\/\d{1,12}$/;

module.exports = async function handler(req, res) {
  const { path, ...rest } = req.query || {};
  if (typeof path !== 'string' || !PATH_OK.test(path)) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Unsupported path' }));
  }
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(rest)) for (const item of [].concat(v)) params.append(k, item);

  const headers = { Accept: 'application/json' };
  if (req.headers['x-fantasy-filter']) headers['X-Fantasy-Filter'] = req.headers['x-fantasy-filter'];
  const s2 = req.headers['x-espn-s2'];
  const swid = req.headers['x-espn-swid'];
  if (s2 && swid) headers.Cookie = `espn_s2=${s2}; SWID=${swid}`;

  try {
    const upstream = await fetch(`${HOST}${path}?${params}`, { headers });
    res.statusCode = upstream.status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(await upstream.text());
  } catch {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: 'Could not reach ESPN' }));
  }
};
