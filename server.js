require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const NodeCache = require('node-cache');
const compression = require('compression');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const events = require('events');
const { URL } = require('url');

events.EventEmitter.defaultMaxListeners = 200;

const app = express();
const PORT = process.env.PORT || 7860;

// ══════════════════════════════════════════════════════════════
// ░░░ CONFIG ULTRA SÉCURISÉE ░░░
// ══════════════════════════════════════════════════════════════
const C = {
  gk: process.env.RTM_GK || process.env.AUTH_KEY || 'rtm_secret_key_2024_ultra',
  mk: process.env.RTM_MK || '973515c7684f56d1472bba67b13d676b',
  mb: process.env.RTM_MB || 'https://api.themoviedb.org/3',
  se: process.env.RTM_SE || 'https://multiembed.mov',
  sd: process.env.RTM_SD || 'https://dl.multiembed.mov',
  si: process.env.RTM_SI || 'https://image.themoviedb.org',
  vp: process.env.RTM_VP || '121206',
  tv: 'https://iptv-org.github.io/iptv/index.m3u',
};
const VIP_HASH = crypto.createHash('sha256').update(C.vp).digest('hex');

// ══════════════════════════════════════════════════════════════
// ░░░ DATA CENTER CACHE ULTRA-RAPIDE ░░░
// ══════════════════════════════════════════════════════════════
const L1 = new NodeCache({ stdTTL: 300, checkperiod: 30, useClones: false });
const L2 = new NodeCache({ stdTTL: 21600, checkperiod: 300, useClones: false });
const LI = new NodeCache({ stdTTL: 604800, checkperiod: 3600, useClones: false });
const LHL = new NodeCache({ stdTTL: 60, checkperiod: 10, useClones: false });
const LPW = new NodeCache({ stdTTL: 86400, checkperiod: 600, useClones: false });

function cGet(k) { return L1.get(k) ?? L2.get(k) ?? LPW.get(k) ?? null; }
function cSet(k, v) { L1.set(k, v); L2.set(k, v); }
function cSetPW(k, v) { LPW.set(k, v); L2.set(k, v); }

const cStats = { hits: 0, misses: 0, imgHits: 0, blocked: 0 };

// ══════════════════════════════════════════════════════════════
// ░░░ AXIOS ULTRA-RAPIDE AVEC POOL KEEPALIVE ░░░
// ══════════════════════════════════════════════════════════════
const agS = new https.Agent({
  keepAlive: true,
  maxSockets: 1000,
  maxFreeSockets: 200,
  keepAliveMsecs: 60000,
  timeout: 90000,
  rejectUnauthorized: false,
});
const agP = new http.Agent({
  keepAlive: true,
  maxSockets: 1000,
  maxFreeSockets: 200,
  keepAliveMsecs: 60000,
});

const ax = axios.create({
  timeout: 30000,
  maxRedirects: 20,
  httpsAgent: agS,
  httpAgent: agP,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Accept': '*/*',
  },
  decompress: true,
  validateStatus: status => status < 500,
});

// Retry avec backoff exponentiel
async function axGet(url, opts = {}) {
  for (let i = 0; i < 4; i++) {
    try {
      return await ax.get(url, opts);
    } catch (e) {
      if (i === 3) throw e;
      if (!['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'EHOSTUNREACH'].includes(e.code)) throw e;
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
}

// ══════════════════════════════════════════════════════════════
// ░░░ BLOCAGE ULTRA-PUISSANT DES ADS & REDIRECTIONS ░░░
// ══════════════════════════════════════════════════════════════
const BLOCKED_DOMAINS = new Set([
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'google-analytics.com', 'googletagmanager.com', 'googletagservices.com',
  'adnxs.com', 'adsafeprotected.com', 'taboola.com', 'outbrain.com',
  'mgid.com', 'revcontent.com', 'criteo.com', 'pubmatic.com',
  'rubiconproject.com', 'openx.net', 'smartadserver.com',
  'serving-sys.com', 'adsrvr.org', 'advertising.com',
  'amazon-adsystem.com', 'adroll.com', 'quantserve.com',
  'popads.net', 'popcash.net', 'propellerads.com', 'adcash.com',
  'clickadu.com', 'exoclick.com', 'trafficjunky.net',
  'adsterra.com', 'hilltopads.net', 'a-ads.com',
  'scorecardresearch.com', 'omtrdc.net', 'demdex.net',
  'hotjar.com', 'mouseflow.com', 'crazyegg.com',
  'imasdk.googleapis.com', 'fwmrm.net', 'videohub.tv',
  'cdn4ads.com', 'adtng.com', 'aniview.com',
]);

const BLOCKED_PATTERNS = [
  /\/ad[s]?\//i, /\/banner[s]?\//i, /\/popup[s]?\//i,
  /\/click[s]?\//i, /\/track[s]?\//i, /\/pixel[s]?\//i,
  /\bad[s]?\./, /\bpop\./, /\bads?serve/, /\badsystem/,
  /\bgoogletag/, /\bdoubleclick/, /\badservice/,
];

function isBlocked(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (BLOCKED_DOMAINS.has(host)) return true;
    for (const blocked of BLOCKED_DOMAINS) {
      if (host.endsWith('.' + blocked)) return true;
    }
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(url)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// ░░░ EXPRESS SETUP ULTRA-SÉCURISÉ ░░░
// ══════════════════════════════════════════════════════════════
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(compression({ level: 6 }));
app.use(cors({
  origin: '*',
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['x-rtm-auth', 'Range', 'Content-Type'],
  exposedHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges', 'X-RTM-Enc'],
}));

app.use((req, res, next) => {
  const referer = req.get('referer') || '';
  if (isBlocked(referer)) {
    cStats.blocked++;
    return res.status(403).send('Blocked');
  }
  
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('X-XSS-Protection', '1; mode=block');
  res.set('Referrer-Policy', 'no-referrer-when-downgrade');
  res.set('Access-Control-Allow-Origin', '*');
  res.set('X-Powered-By', 'VideoVerse-Backend-Ultra');
  res.set('Vary', 'Accept-Encoding');
  
  next();
});

// ══════════════════════════════════════════════════════════════
// ░░░ ENCODAGE CHIFFRÉ BASE64 ░░░
// ══════════════════════════════════════════════════════════════
function enc(res, data) {
  res.set('Content-Type', 'application/x-rtm');
  res.set('X-RTM-Enc', '1');
  res.send(Buffer.from(JSON.stringify(data)).toString('base64'));
}

// ══════════════════════════════════════════════════════════════
// ░░░ AUTH MIDDLEWARE ░░░
// ══════════════════════════════════════════════════════════════
const auth = (req, res, next) => {
  const k = req.headers['x-rtm-auth'] || req.query.auth;
  if (k === C.gk) return next();
  res.status(403).json({ error: 'Unauthorized' });
};

// ══════════════════════════════════════════════════════════════
// ░░░ ROUTES PUBLIQUES ░░░
// ══════════════════════════════════════════════════════════════
app.get('/api/rtm/health', (req, res) => res.json({
  status: 'ok',
  cached: L2.has('channels'),
  total: (cGet('channels') || []).length,
  lastUpdate: cGet('lastUpdate'),
  blocked: cStats.blocked,
}));

// Toutes les routes API → auth
app.use('/api/rtm', auth);

// ══════════════════════════════════════════════════════════════
// ░░░ PARSER M3U ULTRA-RAPIDE ░░░
// ══════════════════════════════════════════════════════════════
function parseM3U(text) {
  const lines = text.split('\n');
  const out = [];
  let cur = null;
  
  for (const raw of lines) {
    const line = raw.trim();
    
    if (line.startsWith('#EXTINF:')) {
      cur = { name: '', logo: '', group: '', country: '', language: '', tvgId: '', url: '' };
      
      const nm = line.match(/,(.+)$/);
      if (nm) cur.name = nm[1].trim();
      
      const lo = line.match(/tvg-logo="([^"]*)"/);
      if (lo) cur.logo = lo[1];
      
      const gr = line.match(/group-title="([^"]*)/);
      if (gr) cur.group = gr[1];
      
      const co = line.match(/tvg-country="([^"]*)"/);
      if (co) cur.country = co[1].toUpperCase();
      
      const la = line.match(/tvg-language="([^"]*)"/);
      if (la) cur.language = la[1];
      
      const id = line.match(/tvg-id="([^"]*)"/);
      if (id) cur.tvgId = id[1];
      
    } else if (line && !line.startsWith('#') && cur) {
      if (cur.name && /^https?:\/\//i.test(line)) {
        cur.url = line;
        if (!isBlocked(line)) {
          out.push({ ...cur });
        } else {
          cStats.blocked++;
        }
      }
      cur = null;
    }
  }
  
  return out;
}

function saveChannels(all) {
  const byC = {}, byG = {}, cs = new Set(), gs = new Set();
  
  for (const ch of all) {
    const c = ch.country || 'XX';
    const g = ch.group || 'Other';
    (byC[c] = byC[c] || []).push(ch);
    (byG[g] = byG[g] || []).push(ch);
    cs.add(c);
    gs.add(g);
  }
  
  cSet('channels', all);
  cSet('byCountry', byC);
  cSet('byGroup', byG);
  cSet('countries', [...cs].sort((a, b) => a === 'MG' ? -1 : b === 'MG' ? 1 : a.localeCompare(b)));
  cSet('groups', [...gs].sort());
  cSet('lastUpdate', new Date().toISOString());
  
  console.log(`✅ ${all.length} chaînes sauvegardées en cache`);
}

let _loading = false;
async function fetchIPTV() {
  if (_loading) return;
  _loading = true;
  
  try {
    console.log('📡 Chargement IPTV depuis:', C.tv);
    
    const response = await axGet(C.tv, {
      timeout: 90000,
      headers: {
        'Accept': 'application/x-mpegURL, application/vnd.apple.mpegurl, */*',
      },
    });
    
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const m3uText = response.data;
    const channels = parseM3U(m3uText);
    
    channels.sort((a, b) => {
      if (a.country === 'MG' && b.country !== 'MG') return -1;
      if (b.country === 'MG' && a.country !== 'MG') return 1;
      return 0;
    });
    
    saveChannels(channels);
    console.log(`📺 ${channels.length} chaînes IPTV chargées avec succès!`);
    
  } catch (e) {
    console.error('❌ Erreur chargement IPTV:', e.message);
  } finally {
    _loading = false;
  }
}

fetchIPTV();
setInterval(fetchIPTV, 6 * 60 * 60 * 1000);

// ══════════════════════════════════════════════════════════════
// ░░░ ROUTES IPTV ░░░
// ══════════════════════════════════════════════════════════════
app.get('/api/rtm/channels', (req, res) => {
  const all = cGet('channels') || [];
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(parseInt(req.query.limit) || 10000, 20000);
  
  enc(res, {
    total: all.length,
    page,
    limit,
    pages: Math.ceil(all.length / limit),
    channels: all.slice((page - 1) * limit, (page - 1) * limit + limit),
  });
});

app.get('/api/rtm/countries', (_, res) => {
  enc(res, { countries: cGet('countries') || [] });
});

app.get('/api/rtm/groups', (_, res) => {
  enc(res, { groups: cGet('groups') || [] });
});

app.get('/api/rtm/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  const country = (req.query.country || '').toUpperCase();
  let ch = cGet('channels') || [];
  
  if (country) ch = ch.filter(c => c.country === country);
  if (q) ch = ch.filter(c => c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));
  
  enc(res, { total: ch.length, results: ch.slice(0, 1000) });
});

// ══════════════════════════════════════════════════════════════
// ░░░ PROXY LIVE TV ░░░
// ══════════════════════════════════════════════════════════════
app.get('/api/rtm/live', async (req, res) => {
  const url = req.query.url;
  
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).send('Invalid URL');
  }
  
  if (isBlocked(url)) {
    cStats.blocked++;
    return res.status(403).send('Blocked');
  }
  
  const ck = 'live:' + url;
  const hit = LHL.get(ck);
  if (hit) {
    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.set('Cache-Control', 'no-store');
    res.set('Access-Control-Allow-Origin', '*');
    return res.send(hit);
  }
  
  try {
    const hdrs = {
      'Accept': '*/*',
      'Connection': 'keep-alive',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    };
    
    try {
      hdrs['Referer'] = new URL(url).origin + '/';
    } catch (_) {}
    
    const up = await axGet(url, {
      responseType: 'stream',
      timeout: 15000,
      headers: hdrs,
    });
    
    const ct = (up.headers['content-type'] || '').toLowerCase();
    const isHLS = ct.includes('mpegurl') || ct.includes('m3u') || /\.m3u8?(\?|$)/i.test(url.split('?')[0]);
    
    if (isHLS) {
      const chunks = [];
      up.data.on('data', chunk => chunks.push(chunk));
      await new Promise((resolve, reject) => {
        up.data.on('end', resolve);
        up.data.on('error', reject);
      });
      
      let m3u = Buffer.concat(chunks).toString('utf8');
      
      const base = url.substring(0, url.lastIndexOf('/') + 1);
      m3u = m3u.split('\n').map(line => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return line;
        if (/^https?:\/\//i.test(t)) {
          if (isBlocked(t)) return '';
          return `/api/rtm/live?url=${encodeURIComponent(t)}`;
        }
        const full = base + t;
        if (isBlocked(full)) return '';
        return `/api/rtm/live?url=${encodeURIComponent(full)}`;
      }).filter(Boolean).join('\n');
      
      LHL.set(ck, m3u);
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Cache-Control', 'no-store');
      res.set('Access-Control-Allow-Origin', '*');
      return res.send(m3u);
      
    } else {
      res.set('Content-Type', up.headers['content-type'] || 'video/mp2t');
      res.set('Access-Control-Allow-Origin', '*');
      if (up.headers['content-length']) res.set('Content-Length', up.headers['content-length']);
      up.data.pipe(res);
    }
    
  } catch (e) {
    console.error('Live error:', e.message);
    res.status(500).send('Stream error');
  }
});

// ══════════════════════════════════════════════════════════════
// ░░░ PROXY IMAGE ░░░
// ══════════════════════════════════════════════════════════════
app.get('/api/rtm/img', async (req, res) => {
  const url = req.query.u;
  if (!url) return res.status(400).end();
  
  if (isBlocked(url)) {
    cStats.blocked++;
    return res.status(403).send('Blocked');
  }
  
  const ck = 'img:' + url;
  const hit = LI.get(ck);
  if (hit) {
    cStats.imgHits++;
    res.set('Content-Type', hit.ct);
    res.set('Cache-Control', 'public, max-age=604800');
    return res.send(hit.buf);
  }
  
  try {
    const r = await axGet(url, { responseType: 'arraybuffer', timeout: 8000 });
    const buf = Buffer.from(r.data);
    const ct = r.headers['content-type'] || 'image/jpeg';
    
    LI.set(ck, { buf, ct });
    res.set('Content-Type', ct);
    res.set('Cache-Control', 'public, max-age=604800');
    res.send(buf);
  } catch (e) {
    res.status(404).end();
  }
});

// ══════════════════════════════════════════════════════════════
// ░░░ TMDB MOVIES/SERIES ░░░
// ══════════════════════════════════════════════════════════════
app.get('/api/rtm/movies/trending', async (req, res) => {
  const ck = 'movies:trending';
  let data = cGet(ck);
  if (!data) {
    try {
      const r = await axGet(`${C.mb}/trending/movie/week?api_key=${C.mk}&language=fr-FR`);
      data = (r.data.results || []).map(m => ({
        ...m,
        streamToken: btoa(JSON.stringify({ type: 'movie', id: m.id }))
      }));
      cSet(ck, data);
    } catch (e) {
      return res.json({ results: [] });
    }
  }
  res.json({ results: data });
});

app.get('/api/rtm/movies/popular', async (req, res) => {
  const ck = 'movies:popular';
  let data = cGet(ck);
  if (!data) {
    try {
      const r = await axGet(`${C.mb}/movie/popular?api_key=${C.mk}&language=fr-FR`);
      data = (r.data.results || []).map(m => ({
        ...m,
        streamToken: btoa(JSON.stringify({ type: 'movie', id: m.id }))
      }));
      cSet(ck, data);
    } catch (e) {
      return res.json({ results: [] });
    }
  }
  res.json({ results: data });
});

app.get('/api/rtm/movies/top', async (req, res) => {
  const ck = 'movies:top';
  let data = cGet(ck);
  if (!data) {
    try {
      const r = await axGet(`${C.mb}/movie/top_rated?api_key=${C.mk}&language=fr-FR`);
      data = (r.data.results || []).map(m => ({
        ...m,
        streamToken: btoa(JSON.stringify({ type: 'movie', id: m.id }))
      }));
      cSet(ck, data);
    } catch (e) {
      return res.json({ results: [] });
    }
  }
  res.json({ results: data });
});

app.get('/api/rtm/movies/upcoming', async (req, res) => {
  const ck = 'movies:upcoming';
  let data = cGet(ck);
  if (!data) {
    try {
      const r = await axGet(`${C.mb}/movie/upcoming?api_key=${C.mk}&language=fr-FR`);
      data = (r.data.results || []).map(m => ({
        ...m,
        streamToken: btoa(JSON.stringify({ type: 'movie', id: m.id }))
      }));
      cSet(ck, data);
    } catch (e) {
      return res.json({ results: [] });
    }
  }
  res.json({ results: data });
});

app.get('/api/rtm/tv/trending', async (req, res) => {
  const ck = 'tv:trending';
  let data = cGet(ck);
  if (!data) {
    try {
      const r = await axGet(`${C.mb}/trending/tv/week?api_key=${C.mk}&language=fr-FR`);
      data = (r.data.results || []).map(m => ({
        ...m,
        streamToken: btoa(JSON.stringify({ type: 'tv', id: m.id }))
      }));
      cSet(ck, data);
    } catch (e) {
      return res.json({ results: [] });
    }
  }
  res.json({ results: data });
});

app.get('/api/rtm/tv/popular', async (req, res) => {
  const ck = 'tv:popular';
  let data = cGet(ck);
  if (!data) {
    try {
      const r = await axGet(`${C.mb}/tv/popular?api_key=${C.mk}&language=fr-FR`);
      data = (r.data.results || []).map(m => ({
        ...m,
        streamToken: btoa(JSON.stringify({ type: 'tv', id: m.id }))
      }));
      cSet(ck, data);
    } catch (e) {
      return res.json({ results: [] });
    }
  }
  res.json({ results: data });
});

app.get('/api/rtm/search/multi', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ results: [] });
  
  const ck = 'search:' + q.toLowerCase();
  let data = cGet(ck);
  if (!data) {
    try {
      const r = await axGet(`${C.mb}/search/multi?api_key=${C.mk}&query=${encodeURIComponent(q)}&language=fr-FR`);
      data = (r.data.results || []).map(m => ({
        ...m,
        streamToken: btoa(JSON.stringify({ 
          type: m.media_type === 'movie' ? 'movie' : 'tv', 
          id: m.id 
        }))
      }));
      cSet(ck, data);
    } catch (e) {
      return res.json({ results: [] });
    }
  }
  res.json({ results: data });
});

app.get('/api/rtm/details', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'Token missing' });
  
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
    const { type, id } = decoded;
    
    const ck = `details:${type}:${id}`;
    let data = cGet(ck);
    if (!data) {
      const r = await axGet(`${C.mb}/${type}/${id}?api_key=${C.mk}&language=fr-FR&append_to_response=videos,credits`);
      data = { ...r.data, streamToken: token };
      cSet(ck, data);
    }
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: 'Invalid token' });
  }
});

// ══════════════════════════════════════════════════════════════
// ░░░ EMBED VIDÉO ░░░
// ══════════════════════════════════════════════════════════════
app.get('/api/rtm/embed', (req, res) => {
  const token = req.query.token;
  const s = req.query.s;
  const ep = req.query.ep;
  
  if (!token) return res.status(400).json({ error: 'Token missing' });
  
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
    const { type, id } = decoded;
    
    let url;
    if (type === 'movie') {
      url = `${C.se}/embed/movie/${id}`;
    } else {
      const season = s || 1;
      const episode = ep || 1;
      url = `${C.se}/embed/tv/${id}/${season}/${episode}`;
    }
    
    res.json({ url });
  } catch (e) {
    res.status(400).json({ error: 'Invalid token' });
  }
});

app.get('/api/rtm/download', (req, res) => {
  const token = req.query.token;
  const s = req.query.s;
  const ep = req.query.ep;
  
  if (!token) return res.status(400).json({ error: 'Token missing' });
  
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
    const { type, id } = decoded;
    
    let url;
    if (type === 'movie') {
      url = `${C.sd}/download/movie/${id}`;
    } else {
      const season = s || 1;
      const episode = ep || 1;
      url = `${C.sd}/download/tv/${id}/${season}/${episode}`;
    }
    
    res.json({ url });
  } catch (e) {
    res.status(400).json({ error: 'Invalid token' });
  }
});

// ══════════════════════════════════════════════════════════════
// ░░░ VIP CHECK ░░░
// ══════════════════════════════════════════════════════════════
app.get('/api/rtm/vip/verify', (req, res) => {
  const code = req.query.code || '';
  const h = crypto.createHash('sha256').update(code).digest('hex');
  res.json({ valid: h === VIP_HASH, token: h === VIP_HASH ? VIP_HASH : null });
});

// ══════════════════════════════════════════════════════════════
// ░░░ DÉMARRAGE SERVEUR ░░░
// ══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔒 VideoVerse BACKEND SÉCURISÉ');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📡 Server : http://localhost:${PORT}`);
  console.log(`🔐 Auth   : ${C.gk.substring(0, 10)}...`);
  console.log(`📺 IPTV   : ${C.tv}`);
  console.log(`🎬 TMDB   : ${C.mb}`);
  console.log(`📹 Embed  : ${C.se}`);
  console.log(`💾 Download: ${C.sd}`);
  console.log(`🛡️  Ads    : ULTRA BLOCKING ENABLED`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
