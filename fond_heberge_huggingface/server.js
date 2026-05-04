const express = require('express');
const path = require('path');
const axios = require('axios');
const NodeCache = require('node-cache');
const fs = require('fs');
const compression = require('compression');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 7860;

// ═══════════════════════════════════════════════════════════════
// ░░░ CONFIGURATION BACKEND ░░░
// ═══════════════════════════════════════════════════════════════
const BACKEND_URL = process.env.BACKEND_URL || 'https://tafitaniaina-tvserveur.hf.space';
const AUTH_KEY = process.env.AUTH_KEY || 'rtm_secret_key_2024_ultra';

console.log('🔗 Backend URL:', BACKEND_URL);
console.log('🔐 Auth Key:', AUTH_KEY.substring(0, 10) + '...');

// ═══════════════════════════════════════════════════════════════
// ░░░ CONNEXIONS KEEP-ALIVE ULTRA-RAPIDES ░░░
// ═══════════════════════════════════════════════════════════════
const agS = new https.Agent({ 
  keepAlive: true, 
  maxSockets: 200, 
  maxFreeSockets: 50,
  keepAliveMsecs: 60000,
});
const agP = new http.Agent({ 
  keepAlive: true, 
  maxSockets: 200, 
  maxFreeSockets: 50,
  keepAliveMsecs: 60000,
});

const client = axios.create({ 
  httpsAgent: agS, 
  httpAgent: agP,
  timeout: 30000,
  maxRedirects: 10,
});

// ═══════════════════════════════════════════════════════════════
// ░░░ CACHE DATA CENTER FRONTEND ░░░
// ═══════════════════════════════════════════════════════════════
const L1 = new NodeCache({ stdTTL: 300, checkperiod: 30, useClones: false });    // 5min
const L2 = new NodeCache({ stdTTL: 86400, checkperiod: 300, useClones: false }); // 24h
const LI = new NodeCache({ stdTTL: 604800, checkperiod: 3600, useClones: false }); // 7j

function cGet(k) { return L1.get(k) ?? L2.get(k) ?? null; }
function cSet(k, v) { L1.set(k, v); L2.set(k, v); }

// ═══════════════════════════════════════════════════════════════
// ░░░ DÉCODEUR RÉPONSE BASE64 DU BACKEND ░░░
// ═══════════════════════════════════════════════════════════════
function decode(data, headers) {
  if (headers['x-rtm-enc'] === '1' || ((headers['content-type'] || '').includes('x-rtm'))) {
    try {
      const str = typeof data === 'string' ? data : data.toString();
      return JSON.parse(Buffer.from(str, 'base64').toString());
    } catch {
      return data;
    }
  }
  return data;
}

// ═══════════════════════════════════════════════════════════════
// ░░░ HEADERS AUTH VERS BACKEND ░░░
// ═══════════════════════════════════════════════════════════════
const authHeaders = (extra = {}) => ({ 
  'x-rtm-auth': AUTH_KEY, 
  ...extra 
});

// ═══════════════════════════════════════════════════════════════
// ░░░ PRE-WARMING AU DÉMARRAGE ░░░
// ═══════════════════════════════════════════════════════════════
async function prewarm() {
  console.log('🔥 Pre-warming cache...');
  
  const routes = [
    '/api/rtm/movies/trending',
    '/api/rtm/movies/popular',
    '/api/rtm/tv/trending',
    '/api/rtm/tv/popular',
    '/api/rtm/channels?page=1&limit=500',
  ];
  
  await Promise.allSettled(routes.map(async p => {
    try {
      const url = `${BACKEND_URL}${p}`;
      const r = await client.get(url, {
        params: { auth: AUTH_KEY },
        headers: authHeaders(),
        timeout: 20000,
      });
      
      const data = decode(r.data, r.headers);
      cSet(p, data);
      console.log('✓ Prewarm:', p);
    } catch (e) {
      console.log('✗ Prewarm:', p, e.message);
    }
  }));
  
  console.log('🚀 Prewarm done — L1:', L1.keys().length, 'L2:', L2.keys().length);
}

// ═══════════════════════════════════════════════════════════════
// ░░░ EXPRESS MIDDLEWARE ░░░
// ═══════════════════════════════════════════════════════════════
app.use(compression({
  level: 7,
  threshold: 512,
  filter: (req) => !/(\/stream|\/img|\/live|\/seg|\/embed)/.test(req.path),
}));

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('X-XSS-Protection', '1; mode=block');
  res.set('Referrer-Policy', 'no-referrer-when-downgrade');
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Range,Content-Type,Authorization');
  res.set('Access-Control-Expose-Headers', 'Content-Range,Content-Length,Accept-Ranges');
  res.set('X-Powered-By', 'VideoVerse-Frontend');
  
  // Strict CSP
  res.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' fonts.googleapis.com; font-src 'self' fonts.gstatic.com fonts.googleapis.com; img-src 'self' data: https:; media-src 'self' blob:; connect-src 'self'; frame-src 'self' https://www.youtube.com;");

  next();
});

app.options('*', (_, res) => res.sendStatus(204));

// ═══════════════════════════════════════════════════════════════
// ░░░ BLOCAGE ADS CLIENT-SIDE ░░░
// ═══════════════════════════════════════════════════════════════
const ADS_PATTERNS = [
  /doubleclick/i, /googlesyndication/i, /adservice/i,
  /popads/i, /popcash/i, /taboola/i, /outbrain/i,
  /\/ad[s]?\//i, /\/banner/i, /\/popup/i,
];

function isAd(url) {
  return ADS_PATTERNS.some(p => p.test(url));
}

// ═══════════════════════════════════════════════════════════════
// ░░░ PROXY IMAGE ULTRA-RAPIDE ░░░
// ═══════════════════════════════════════════════════════════════
app.get('/api/rtm/img', async (req, res) => {
  const url = req.query.u;
  if (!url) return res.status(400).end();
  
  if (isAd(url)) return res.status(403).end();
  
  const ck = 'img:' + url;
  const hit = LI.get(ck);
  if (hit) {
    res.set('Content-Type', hit.ct);
    res.set('Cache-Control', 'public, max-age=604800');
    return res.send(hit.buf);
  }
  
  try {
    const backendUrl = `${BACKEND_URL}/api/rtm/img?u=${encodeURIComponent(url)}&auth=${AUTH_KEY}`;
    const r = await client.get(backendUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: authHeaders(),
    });
    
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

// ═══════════════════════════════════════════════════════════════
// ░░░ PROXY LIVE TV ░░░
// ═══════════════════════════════════════════════════════════════
app.get('/api/rtm/live', async (req, res) => {
  const { url, id, sid } = req.query;
  if (!url && !id && !sid) return res.status(400).end();
  
  if (url && isAd(url)) return res.status(403).end();
  
  const params = { auth: AUTH_KEY };
  if (url) params.url = url;
  if (id) params.id = id;
  if (sid) params.sid = sid;

  const go = () => client.get(`${BACKEND_URL}/api/rtm/live`, {
    params,
    headers: authHeaders(),
    responseType: 'stream',
    timeout: 20000,
    maxRedirects: 15,
  });
  
  try {
    let r;
    try {
      r = await go();
    } catch {
      r = await go(); // Retry une fois
    }
    
    res.set('Content-Type', r.headers['content-type'] || 'application/vnd.apple.mpegurl');
    res.set('Cache-Control', 'no-store');
    res.set('Access-Control-Allow-Origin', '*');
    
    r.data.pipe(res);
    r.data.on('error', () => {
      if (!res.headersSent) res.status(503).end();
    });
    req.on('close', () => r.data.destroy());
    
  } catch (e) {
    if (!res.headersSent) {
      res.status(503).json({ error: 'Stream unavailable' });
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// ░░░ PROXY EMBED VIDÉO (CRUCIAL POUR STREAMING) ░░░
// ═══════════════════════════════════════════════════════════════
app.get('/api/rtm/embed', async (req, res) => {
  const token = req.query.token;
  const s = req.query.s;
  const ep = req.query.ep;
  
  if (!token) return res.status(400).json({ error: 'Token missing' });
  
  try {
    let url = `${BACKEND_URL}/api/rtm/embed?token=${encodeURIComponent(token)}&auth=${AUTH_KEY}`;
    if (s) url += `&s=${s}`;
    if (ep) url += `&ep=${ep}`;
    
    const r = await client.get(url, {
      headers: authHeaders(),
      timeout: 10000,
    });
    
    const data = decode(r.data, r.headers);
    res.json(data);
    
  } catch (e) {
    console.error('Embed error:', e.message);
    res.status(500).json({ error: 'Embed error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// ░░░ PROXY GÉNÉRAL AVEC CACHE ░░░
// ═══════════════════════════════════════════════════════════════
app.get('/api/rtm/*', async (req, res) => {
  const path = req.path;
  const ck = path + JSON.stringify(req.query);
  
  // Cache check
  const hit = cGet(ck);
  if (hit && !path.includes('health')) {
    res.set('X-Cache', 'HIT');
    return res.json(hit);
  }
  
  // Proxy vers backend
  const go = (timeout) => client.get(`${BACKEND_URL}${path}`, {
    params: { ...req.query, auth: AUTH_KEY },
    headers: authHeaders(),
    timeout,
  });
  
  try {
    let r;
    try {
      r = await go(20000);
    } catch (e) {
      if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') {
        r = await go(40000); // Retry avec timeout plus long
      } else {
        throw e;
      }
    }
    
    const data = decode(r.data, r.headers);
    
    // Cache seulement si succès
    if (r.status === 200) {
      cSet(ck, data);
    }
    
    res.set('X-Cache', 'MISS');
    res.json(data);
    
  } catch (e) {
    console.error('Backend error:', path, e.message);
    res.status(e.response?.status || 500).json({ 
      error: 'Backend error',
      message: e.message 
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// ░░░ PAGES HTML ░░░
// ═══════════════════════════════════════════════════════════════
// Utiliser le dossier "public" pour les fichiers
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/streaming', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'streaming.html'));
});


// ═══════════════════════════════════════════════════════════════
// ░░░ DÉMARRAGE SERVEUR ░░░
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌐 VideoVerse FRONTEND');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📡 Server  : http://localhost:${PORT}`);
  console.log(`🔗 Backend : ${BACKEND_URL}`);
  console.log(`🛡️  Security: URLs cachées du client`);
  console.log(`🚀 Pages   : / et /streaming`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  // Pre-warm en arrière-plan
  setTimeout(prewarm, 3000);
  setInterval(prewarm, 3 * 60 * 60 * 1000); // Refresh 3h
});
