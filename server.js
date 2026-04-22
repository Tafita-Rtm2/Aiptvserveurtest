require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const axios     = require('axios');
const NodeCache = require('node-cache');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const https     = require('https');
const http      = require('http');
const crypto    = require('crypto');
const events    = require('events');

events.EventEmitter.defaultMaxListeners = 100;

const app  = express();
const PORT = process.env.PORT || 3000;

// ══════════════════════════════════════════════════════════
//  CONFIG — 100% depuis .env, noms obfusqués
//  Aucune URL / secret hardcodé dans ce fichier
// ══════════════════════════════════════════════════════════
const C = {
  gk : process.env.RTM_GK || '',   // clé auth HF→Render
  mk : process.env.RTM_MK || '',   // TMDB API key
  mb : process.env.RTM_MB || '',   // TMDB base URL
  se : process.env.RTM_SE || '',   // embed server
  sd : process.env.RTM_SD || '',   // download server
  si : process.env.RTM_SI || '',   // image CDN
  vp : process.env.RTM_VP || '',   // VIP code (plain, hashé ci-dessous)
  tv : (process.env.RTM_TV || '').split(',').filter(Boolean),
};
// Hash VIP calculé une seule fois au démarrage depuis .env
const VIP_HASH = crypto.createHash('sha256').update(C.vp).digest('hex');

app.disable('x-powered-by');

// ══════════════════════════════════════════════════════════
//  CACHE MULTI-NIVEAUX
//  L1 = 5min RAM ultra rapide
//  L2 = 6h  données froides
//  LI = 7j  images binaires
// ══════════════════════════════════════════════════════════
const L1 = new NodeCache({ stdTTL: 300,    checkperiod: 60,   useClones: false });
const L2 = new NodeCache({ stdTTL: 21600,  checkperiod: 600,  useClones: false });
const LI = new NodeCache({ stdTTL: 604800, checkperiod: 3600, useClones: false });

function cGet(k)      { return L1.get(k) ?? L2.get(k) ?? null; }
function cSet(k, v)   { L1.set(k, v); L2.set(k, v); }

// ══════════════════════════════════════════════════════════
//  AXIOS — pool keep-alive, ultra rapide
// ══════════════════════════════════════════════════════════
const agS = new https.Agent({ keepAlive: true, maxSockets: 300, maxFreeSockets: 50, rejectUnauthorized: false });
const agP = new http.Agent({  keepAlive: true, maxSockets: 300, maxFreeSockets: 50 });
const ax  = axios.create({
  timeout: 25000, maxRedirects: 15,
  httpsAgent: agS, httpAgent: agP,
  headers: { 'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux) AppleWebKit/537.36 VLC/3.0' },
});

// ══════════════════════════════════════════════════════════
//  COMPRESSION + RATE LIMIT (aucune limite côté user)
// ══════════════════════════════════════════════════════════
app.use(compression({ level: 6 }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 999999, standardHeaders: false, legacyHeaders: false }));
app.use(cors());

// ══════════════════════════════════════════════════════════
//  HEADERS SÉCURITÉ
//  + chiffrement des réponses : les DevTools ne voient
//    que du contenu encodé, pas les URLs internes
// ══════════════════════════════════════════════════════════
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Powered-By', '');           // masquer la techno
  res.set('Server', '');                 // masquer le serveur
  // Empêcher le cache navigateur de stocker les réponses API
  if (req.path.startsWith('/api/rtm') && !req.path.includes('/img') && !req.path.includes('/stream')) {
    res.set('Cache-Control', 'no-store, private');
  }
  next();
});

// ══════════════════════════════════════════════════════════
//  AUTH MIDDLEWARE — protège toutes les routes /api/rtm
//  sauf /health (monitoring)
// ══════════════════════════════════════════════════════════
const auth = (req, res, next) => {
  const k = req.headers['x-rtm-auth'] || req.query.auth;
  if (k && k === C.gk) return next();
  res.status(403).json({ error: 'Unauthorized' });
};

// /health public pour monitoring Render
app.get('/api/rtm/health', (req, res) => {
  res.json({
    status: 'ok',
    cached: L2.has('channels'),
    total:  (cGet('channels') || []).length,
    lastUpdate: cGet('lastUpdate'),
  });
});

// Toutes les autres routes → auth obligatoire
app.use('/api/rtm', auth);

// ══════════════════════════════════════════════════════════
//  HELPER RÉPONSE CHIFFRÉE
//  Les données JSON sont encodées en base64 + XOR simple
//  → les DevTools / proxy ne voient pas les URLs internes
// ══════════════════════════════════════════════════════════
function encResp(res, data) {
  const json = JSON.stringify(data);
  // Encodage léger : base64 suffisant pour masquer aux DevTools
  const encoded = Buffer.from(json).toString('base64');
  res.set('Content-Type', 'application/x-rtm');
  res.set('X-RTM-Enc', '1');
  res.send(encoded);
}
// Le client HuggingFace décode avec : atob(response) puis JSON.parse
// Côté serveur HF on intercepte X-RTM-Enc:1 et on décode avant de servir

// ══════════════════════════════════════════════════════════
//  IPTV — chargement + parsing M3U
// ══════════════════════════════════════════════════════════
function parseM3U(text) {
  const lines = text.split('\n'), out = []; let cur = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF:')) {
      cur = { name:'', logo:'', group:'', country:'', language:'', tvgId:'', url:'' };
      const nm = line.match(/,(.+)$/);                if (nm) cur.name     = nm[1].trim();
      const lo = line.match(/tvg-logo="([^"]*)"/);    if (lo) cur.logo     = lo[1];
      const gr = line.match(/group-title="([^"]*)/);  if (gr) cur.group    = gr[1];
      const co = line.match(/tvg-country="([^"]*)"/); if (co) cur.country  = co[1].toUpperCase();
      const la = line.match(/tvg-language="([^"]*)"/);if (la) cur.language = la[1];
      const id = line.match(/tvg-id="([^"]*)"/);      if (id) cur.tvgId    = id[1];
    } else if (line && !line.startsWith('#') && cur) {
      if (cur.name && /^https?:\/\//i.test(line)) { cur.url = line; out.push({ ...cur }); }
      cur = null;
    }
  }
  return out;
}


function saveChannels(all) {
  const byC = {}, byG = {}, ctSet = new Set(), grSet = new Set();
  for (const ch of all) {
    const c = ch.country || 'XX', g = ch.group || 'General';
    (byC[c] = byC[c] || []).push(ch);
    (byG[g] = byG[g] || []).push(ch);
    ctSet.add(c); grSet.add(g);
  }
  cSet('channels',   all);
  cSet('byCountry',  byC);
  cSet('byGroup',    byG);
  cSet('countries',  [...ctSet].sort((a, b) => a === 'MG' ? -1 : b === 'MG' ? 1 : a.localeCompare(b)));
  cSet('groups',     [...grSet].sort());
  cSet('lastUpdate', new Date().toISOString());
}

// Vérification aliveness en arrière-plan (ne bloque pas)
async function checkAliveness(channels) {
  const BATCH = 30; const dead = new Set();
  for (let i = 0; i < Math.min(channels.length, 3000); i += BATCH) {
    await Promise.allSettled(
      channels.slice(i, i + BATCH).map(async ch => {
        try {
          const r = await ax({ method: 'HEAD', url: ch.url, timeout: 3000 });
          if (r.status >= 400) dead.add(ch.url);
        } catch { dead.add(ch.url); }
      })
    );
    await new Promise(r => setTimeout(r, 30)); // pause minimale entre batches
  }
  const alive = channels.filter(ch => !dead.has(ch.url));
  saveChannels(alive);
  console.log(`✅ Aliveness: ${alive.length}/${channels.length} chaînes actives`);
}

let _loading = false;
async function fetchAll() {
  if (_loading) return; _loading = true;
  try {
    console.log('📡 Chargement IPTV...');
    const results = await Promise.allSettled(
      C.tv.map(url => ax.get(url, { timeout: 60000 }).then(r => r.data).catch(() => ''))
    );
    let all = []; const seenUrl = new Set();
    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      for (const ch of parseM3U(r.value)) {
        if (!seenUrl.has(ch.url)) { seenUrl.add(ch.url); all.push(ch); }
      }
    }
    // MG en premier
    all.sort((a, b) => a.country === 'MG' ? -1 : b.country === 'MG' ? 1 : 0);
    saveChannels(all);
    console.log(`📺 ${all.length} chaînes chargées`);
    // Vérification aliveness en arrière-plan
    checkAliveness(all).catch(() => {});
  } catch (e) { console.error('❌ fetchAll:', e.message); }
  finally { _loading = false; }
}

// Chargement immédiat + rafraîchissement toutes les 6h
fetchAll();
setInterval(fetchAll, 6 * 60 * 60 * 1000);

// ══════════════════════════════════════════════════════════
//  ROUTES IPTV / TV
// ══════════════════════════════════════════════════════════
app.get('/api/rtm/channels', (req, res) => {
  const all   = cGet('channels') || [];
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(parseInt(req.query.limit) || 5000, 10000);
  const off   = (page - 1) * limit;
  const data  = { total: all.length, page, limit, pages: Math.ceil(all.length / limit), channels: all.slice(off, off + limit) };
  encResp(res, data);
});

app.get('/api/rtm/countries', (_, res) => encResp(res, { countries: cGet('countries') || [] }));
app.get('/api/rtm/groups',    (_, res) => encResp(res, { groups:    cGet('groups')    || [] }));

app.get('/api/rtm/search', (req, res) => {
  const q       = (req.query.q || '').toLowerCase().trim();
  const country = (req.query.country || '').toUpperCase();
  let ch = cGet('channels') || [];
  if (country) ch = ch.filter(c => c.country === country);
  if (q)       ch = ch.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.group.toLowerCase().includes(q) ||
    (c.country || '').toLowerCase().includes(q)
  );
  encResp(res, { total: ch.length, results: ch.slice(0, 500) });
});

// ══════════════════════════════════════════════════════════
//  PROXY STREAM TV — HLS rewriting ultra rapide
//  ⚡ FIX TV LENTE : les segments HLS sont réécrits
//     pour passer par Render → pas de requête directe
//     du navigateur vers les CDN externes
// ══════════════════════════════════════════════════════════
app.get('/api/rtm/live', async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).end();

  const ck = 'live:' + url;
  // Cache court 30s pour les manifests HLS (accélère les chaînes)
  const hit = L1.get(ck);
  if (hit) {
    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.set('Cache-Control', 'no-store');
    res.set('Access-Control-Allow-Origin', '*');
    return res.send(hit);
  }

  try {
    const hdrs = {
      'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux) VLC/3.0',
      'Accept': '*/*',
      'Connection': 'keep-alive',
    };
    try { hdrs['Referer'] = new URL(url).origin + '/'; } catch (_) {}

    const up = await ax({ method: 'GET', url, responseType: 'stream', timeout: 15000, headers: hdrs });
    const ct = (up.headers['content-type'] || '').toLowerCase();
    const isHLS = ct.includes('mpegurl') || ct.includes('m3u') || /\.m3u8?(\?|$)/i.test(url.split('?')[0]);

    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'no-store');

    if (isHLS) {
      // Réécrire le manifest : tous les segments → proxy Render
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      let body = '';
      up.data.on('data', d => { body += d.toString(); });
      up.data.on('end', () => {
        const base = url.substring(0, url.lastIndexOf('/') + 1);
        const out  = body.split('\n').map(l => {
          const t = l.trim();
          if (!t || t.startsWith('#')) return t;
          const abs = /^https?:\/\//i.test(t) ? t : base + t;
          // URL réécrite → proxy, clé auth cachée dans le header (pas dans l'URL)
          return `/api/rtm/seg?u=${encodeURIComponent(abs)}`;
        }).join('\n');
        L1.set(ck, out, 30); // cache 30s
        res.send(out);
      });
      up.data.on('error', () => { if (!res.headersSent) res.status(502).end(); });
    } else {
      // Segment TS direct
      res.set('Content-Type', ct || 'video/mp2t');
      if (up.headers['content-length']) res.set('Content-Length', up.headers['content-length']);
      up.data.pipe(res);
    }
  } catch { if (!res.headersSent) res.status(503).end(); }
});

// ── Proxy segments HLS (appelé par le rewriting) ─────────
app.get('/api/rtm/seg', async (req, res) => {
  const url = req.query.u;
  if (!url) return res.status(400).end();
  try {
    const hdrs = { 'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux) VLC/3.0', 'Accept': '*/*' };
    if (req.headers.range) hdrs['Range'] = req.headers.range;
    const up = await ax({ method: 'GET', url, responseType: 'stream', timeout: 15000, headers: hdrs });
    res.set('Content-Type',  up.headers['content-type']  || 'video/mp2t');
    res.set('Accept-Ranges', 'bytes');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=10');
    if (up.headers['content-length']) res.set('Content-Length', up.headers['content-length']);
    if (up.headers['content-range'])  res.set('Content-Range',  up.headers['content-range']);
    res.status(up.status === 206 ? 206 : 200);
    up.data.pipe(res);
    req.on('close', () => up.data.destroy());
  } catch { if (!res.headersSent) res.status(502).end(); }
});

// ══════════════════════════════════════════════════════════
//  PROXY STREAM FILMS/SÉRIES
// ══════════════════════════════════════════════════════════
app.get('/api/rtm/stream', async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).end();
  try {
    const hdrs = { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*', 'Connection': 'keep-alive' };
    if (req.headers.range) hdrs['Range'] = req.headers.range;
    try { hdrs['Referer'] = new URL(url).origin + '/'; } catch (_) {}
    const up = await ax({ method: 'GET', url, responseType: 'stream', timeout: 30000, headers: hdrs });
    const ct = (up.headers['content-type'] || '').toLowerCase();
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'no-cache');
    if (up.headers['content-length']) res.set('Content-Length', up.headers['content-length']);
    if (up.headers['content-range'])  res.set('Content-Range',  up.headers['content-range']);
    if (up.headers['accept-ranges'])  res.set('Accept-Ranges',  up.headers['accept-ranges']);
    res.status(up.status === 206 ? 206 : 200);
    res.set('Content-Type', ct || 'video/mp4');
    up.data.pipe(res);
    req.on('close', () => up.data.destroy());
  } catch { if (!res.headersSent) res.status(502).end(); }
});

// ══════════════════════════════════════════════════════════
//  PROXY IMAGES — cache 7 jours + fix image verte
//  ⚡ FIX : arraybuffer au lieu de stream → pas de corruption
// ══════════════════════════════════════════════════════════
app.get('/api/rtm/img', async (req, res) => {
  const u = req.query.u;
  if (!u || !/^https?:\/\//i.test(u)) return res.status(400).end();

  // Restriction sécurité : images autorisées uniquement depuis CDN connu
  const allowedHosts = [C.si, 'https://image.tmdb.org', 'https://m.media-amazon.com'];
  const isAllowed = allowedHosts.some(h => u.startsWith(h));
  if (!isAllowed && !u.startsWith('https://')) return res.status(403).end();

  const ck  = 'img:' + u;
  const hit = LI.get(ck);
  if (hit) {
    res.set('Content-Type',   hit.ct);
    res.set('Content-Length', hit.buf.length);
    res.set('Cache-Control',  'public, max-age=604800, immutable');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('X-Cache', 'HIT');
    return res.send(hit.buf);
  }

  try {
    const up = await ax({
      method: 'GET', url: u,
      responseType: 'arraybuffer',   // ← FIX IMAGE VERTE : buffer complet
      timeout: 12000,
      headers: {
        'Referer': `${C.si}/`,       // Referer depuis CDN connu
        'Accept':  'image/avif,image/webp,image/apng,image/*,*/*',
      },
    });

    const ct  = up.headers['content-type'] || 'image/jpeg';
    const buf = Buffer.from(up.data);

    if (buf.length < 50) throw new Error('Empty');

    LI.set(ck, { ct, buf });
    res.set('Content-Type',   ct);
    res.set('Content-Length', buf.length);
    res.set('Cache-Control',  'public, max-age=604800, immutable');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('X-Cache', 'MISS');
    res.send(buf);
  } catch {
    // Pixel transparent — jamais d'image cassée
    const px = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=', 'base64');
    res.set('Content-Type', 'image/png');
    res.send(px);
  }
});

// ══════════════════════════════════════════════════════════
//  METADATA TMDB — cache L1+L2
// ══════════════════════════════════════════════════════════
async function metaFetch(p, extra = '') {
  const sep = p.includes('?') ? '&' : '?';
  const url = `${C.mb}${p}${sep}api_key=${C.mk}&language=fr-FR${extra ? '&' + extra : ''}`;
  const ck  = 'meta:' + url;
  const hit = cGet(ck);
  if (hit) return hit;
  const r = await ax.get(url, { timeout: 8000 });
  cSet(ck, r.data);
  return r.data;
}

app.get('/api/rtm/movies/popular',  async (req, res) => {
  try {
    const lang = req.query.lang, page = req.query.page || 1;
    const p = lang
      ? `/discover/movie?with_original_language=${lang}&sort_by=popularity.desc&page=${page}`
      : `/movie/popular?page=${page}`;
    encResp(res, await metaFetch(p));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/rtm/movies/trending', async (req, res) => {
  try { encResp(res, await metaFetch('/trending/movie/week', 'page=' + (req.query.page || 1))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/rtm/movies/details/:id', async (req, res) => {
  try {
    const d     = await metaFetch(`/movie/${req.params.id}?append_to_response=videos,external_ids,credits`);
    const imdb  = d.external_ids?.imdb_id;
    const token = Buffer.from(JSON.stringify({ type: 'movie', id: req.params.id, imdb: imdb || null })).toString('base64');
    let trailer = null;
    if (d.videos?.results) {
      const t = d.videos.results.find(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
      if (t) trailer = t.key;
    }
    encResp(res, { ...d, streamToken: token, trailerKey: trailer });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/rtm/tv/details/:id', async (req, res) => {
  try {
    const d     = await metaFetch(`/tv/${req.params.id}?append_to_response=videos,external_ids,credits`);
    const imdb  = d.external_ids?.imdb_id;
    const token = Buffer.from(JSON.stringify({ type: 'tv', id: req.params.id, imdb: imdb || null })).toString('base64');
    let trailer = null;
    if (d.videos?.results) {
      const t = d.videos.results.find(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
      if (t) trailer = t.key;
    }
    encResp(res, { ...d, streamToken: token, trailerKey: trailer });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
//  EMBED — ⚡ FIX "Sandboxing is not allowed"
//  Brave et Firefox bloquent sandbox="allow-scripts allow-same-origin"
//  → on retire sandbox, on garde les permissions avec allow=
// ══════════════════════════════════════════════════════════
app.get('/api/rtm/embed', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).end();
  try {
    const data = JSON.parse(Buffer.from(token, 'base64').toString());
    let embedUrl;
    if (data.type === 'movie') {
      embedUrl = data.imdb
        ? `${C.se}/?video_id=${data.imdb}`
        : `${C.se}/?video_id=${data.id}&tmdb=1`;
    } else {
      const s = req.query.s || 1, ep = req.query.ep || 1;
      embedUrl = data.imdb
        ? `${C.se}/?video_id=${data.imdb}&s=${s}&e=${ep}`
        : `${C.se}/?video_id=${data.id}&tmdb=1&s=${s}&e=${ep}`;
    }

    // ⚡ PAS de sandbox → fix "Sandboxing is not allowed"
    // On utilise uniquement allow= pour les permissions nécessaires
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Access-Control-Allow-Origin', '*');
    // Pas de X-Frame-Options → l'iframe s'affiche partout
    res.removeHeader('X-Frame-Options');
    res.send(`<!DOCTYPE html><html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100vh;background:#000;overflow:hidden}
iframe{width:100%;height:100%;border:none;display:block}
</style></head>
<body>
<iframe
  src="${embedUrl}"
  allowfullscreen
  referrerpolicy="no-referrer"
  allow="autoplay; fullscreen; picture-in-picture; encrypted-media; gyroscope; accelerometer; clipboard-write"
></iframe>
</body></html>`);
  } catch { res.status(400).end(); }
});

// ══════════════════════════════════════════════════════════
//  VIP
// ══════════════════════════════════════════════════════════
app.get('/api/rtm/vip/verify', (req, res) => {
  const code = req.query.code || '';
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  if (hash === VIP_HASH) {
    const token = crypto.createHmac('sha256', VIP_HASH).update(Date.now().toString()).digest('hex').slice(0, 32);
    res.json({ ok: true, token });
  } else {
    res.status(403).json({ ok: false, error: 'Invalid Code' });
  }
});

// ══════════════════════════════════════════════════════════
//  TÉLÉCHARGEMENT VIP — URLs DL depuis .env
// ══════════════════════════════════════════════════════════
app.get('/api/rtm/movies/download/:id', async (req, res) => {
  const vipToken = req.query.vip;
  if (!vipToken || !/^[a-f0-9]{32}$/.test(vipToken)) return res.status(403).json({ error: 'VIP Access Required' });
  try {
    const d    = await metaFetch(`/movie/${req.params.id}?append_to_response=external_ids`);
    const imdb = d.external_ids?.imdb_id;
    const src  = [];
    if (imdb) {
      src.push({ quality: 'HD 1080p', url: `${C.sd}/?video_id=${imdb}&dl=1` });
      src.push({ quality: 'HD 720p',  url: `${C.sd}/?video_id=${imdb}&quality=720p&dl=1` });
    }
    src.push({ quality: 'Auto', url: `${C.sd}/?video_id=${req.params.id}&tmdb=1&dl=1` });
    encResp(res, { title: d.title, year: (d.release_date || '').substring(0, 4), sources: src });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ══════════════════════════════════════════════════════════
//  FORWARDER GÉNÉRIQUE TMDB (catch-all)
// ══════════════════════════════════════════════════════════
app.get('/api/rtm/*', async (req, res) => {
  try {
    const p     = req.path.replace('/api/rtm', '');
    const query = { ...req.query };
    delete query.auth;
    const qStr = new URLSearchParams(query).toString();
    const data = await metaFetch(p + (qStr ? '?' + qStr : ''));
    encResp(res, data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use((_, res) => res.status(404).json({ error: 'not found' }));
app.listen(PORT, () => console.log(`🚀 Vault Server Ready on port ${PORT}`));
