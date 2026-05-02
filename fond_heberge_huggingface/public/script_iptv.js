'use strict';

// ══════════════════════════════════════════════════════════════
// ░░░ ÉTAT GLOBAL ░░░
// ══════════════════════════════════════════════════════════════
const S = {
  all: [],
  filtered: [],
  events: [],
  countries: [],
  ps: 120,      // Page size
  dispIdx: 0,   // Display index
  view: 'all',  // current view (all, mg, sport, etc)
  country: null,
  group: null,
  tab: 'live',  // active tab (live, radio, events)
  q: '',        // search query
  cq: '',       // country list search query
  dataSaver: false,
  currentCh: null,
  scrollLoading: false
};

const F={MG:'🇲🇬',FR:'🇫🇷',US:'🇺🇸',GB:'🇬🇧',DE:'🇩🇪',IT:'🇮🇹',ES:'🇪🇸',PT:'🇵🇹',
  RU:'🇷🇺',CN:'🇨🇳',JP:'🇯🇵',KR:'🇰🇷',IN:'🇮🇳',BR:'🇧🇷',AR:'🇦🇷',MX:'🇲🇽',
  SA:'🇸🇦',AE:'🇦🇪',EG:'🇪🇬',MA:'🇲🇦',TN:'🇹🇳',DZ:'🇩🇿',SN:'🇸🇳',NG:'🇳🇬',
  ZA:'🇿🇦',KE:'🇰🇪',MU:'🇲🇺',RE:'🇷🇪',CM:'🇨🇲',CI:'🇨🇮',TR:'🇹🇷',NL:'🇳🇱',
  BE:'🇧🇪',CH:'🇨🇭',AT:'🇦🇹',SE:'🇸🇪',DK:'🇩🇰',FI:'🇫🇮',GR:'🇬🇷',UA:'🇺🇦',
  RO:'🇷🇴',CA:'🇨🇦',AU:'🇦🇺',ID:'🇮🇩',MY:'🇲🇾',TH:'🇹🇭',VN:'🇻🇳',PH:'🇵🇭',
  PK:'🇵🇰',IR:'🇮🇷',IQ:'🇮🇶',SY:'🇸🇾',KW:'🇰🇼',QA:'🇶🇦',IL:'🇮🇱',KM:'🇰🇲',XX:'🌐'};

const CN={MG:'Madagascar',FR:'France',US:'États-Unis',GB:'Royaume-Uni',DE:'Allemagne',
  IT:'Italie',ES:'Espagne',PT:'Portugal',RU:'Russie',CN:'Chine',JP:'Japon',KR:'Corée',
  IN:'Inde',BR:'Brésil',AR:'Argentine',MX:'Mexique',SA:'Arabie Saoudite',AE:'Émirats',
  EG:'Égypte',MA:'Maroc',TN:'Tunisie',DZ:'Algérie',SN:'Sénégal',NG:'Nigéria',
  ZA:'Afrique du Sud',KE:'Kenya',MU:'Maurice',RE:'Réunion',CM:'Cameroun',
  CI:"Côte d'Ivoire",TR:'Turquie',NL:'Pays-Bas',BE:'Belgique',CH:'Suisse',
  CA:'Canada',AU:'Australie',KM:'Comores'};

const ICON={sport:'sports_soccer',news:'newspaper',kids:'child_care',movies:'theaters',
  music:'music_note',radio:'radio',nature:'forest',religion:'church',tv:'live_tv'};

const EV=['champions','premier league','ligue 1','serie a','bundesliga','la liga',
  'copa','world cup','can ','afcon','olympic','bein','eurosport','supersport'];

// ══════════════════════════════════════════════════════════════
// ░░░ SÉCURITÉ & ANTI-F12 ░░░
// ══════════════════════════════════════════════════════════════
(function() {
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('keydown', e => {
    if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['I','J','C'].includes(e.key)) || (e.ctrlKey && e.key === 'u')) {
      e.preventDefault();
    }
  });
})();

// ══════════════════════════════════════════════════════════════
// ░░░ UTILS ░░░
// ══════════════════════════════════════════════════════════════
function toast(msg, type = 'info') {
  const c = document.getElementById('toasts');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function prog(p, m) {
  const bf = document.getElementById('bf');
  const bm = document.getElementById('bm');
  if (bf) bf.style.width = p + '%';
  if (bm) bm.textContent = m;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function api(p) {
  const r = await fetch(p);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const ct = r.headers.get('Content-Type') || '';
  const enc = r.headers.get('X-RTM-Enc');
  if (enc === '1' || ct.includes('x-rtm')) {
    const t = await r.text();
    try { return JSON.parse(atob(t)); } catch { return JSON.parse(t); }
  }
  return r.json();
}

function cat(ch) {
  const t = ((ch.group || '') + ' ' + (ch.name || '')).toLowerCase();
  if (/sport|foot|soccer|basket|tennis|olymp|cricket|rugby|golf|nba|nfl|f1|formula|handball/.test(t)) return 'sport';
  if (/news|info|actual|bbc|cnn|aljazeera|breaking|journal|24h|rfi|africanews/.test(t)) return 'news';
  if (/kids|child|cartoon|disney|junior|baby|nickel|toon|gulli/.test(t)) return 'kids';
  if (/movie|film|cinema|serie|entertain|hbo/.test(t)) return 'movies';
  if (/music|mtv|clip|chart|hit|rock|jazz/.test(t)) return 'music';
  if (/radio/.test(t)) return 'radio';
  if (/nature|discovery|national|geo|animal|planet/.test(t)) return 'nature';
  if (/religi|church|islam|christian|quran|prayer|gospel/.test(t)) return 'religion';
  return 'tv';
}

// ══════════════════════════════════════════════════════════════
// ░░░ BOOT ░░░
// ══════════════════════════════════════════════════════════════
async function boot() {
  prog(5, 'Connexion...');
  for (let i = 0; i < 25; i++) {
    try {
      const h = await api('/api/rtm/health');
      if (h.cached && h.total > 0) break;
      prog(8 + i * 2, 'Chargement: ' + (h.total || 0) + '...');
      await sleep(2000);
    } catch (e) {
      prog(5, 'Reconnexion...');
      await sleep(3000);
    }
  }

  prog(50, 'Récupération...');
  try {
    let all = [], p = 1, pages = 1;
    do {
      const d = await api('/api/rtm/channels?page=' + p + '&limit=5000');
      all = all.concat(d.channels || []);
      pages = d.pages || 1;
      prog(50 + Math.round(p / pages * 42), all.length.toLocaleString() + '...');
      p++;
    } while (p <= pages);

    S.all = all;
    S.events = S.all.filter(ch => EV.some(k => ((ch.name || '') + ' ' + (ch.group || '')).toLowerCase().includes(k)));
    const cs = new Set();
    S.all.forEach(c => { if (c.country) cs.add(c.country); });
    S.countries = [...cs].sort((a, b) => a === 'MG' ? -1 : b === 'MG' ? 1 : a.localeCompare(b));

    document.getElementById('totC').textContent = S.all.length.toLocaleString();
    buildCL();
    buildPills();
    applyFilters();

    prog(100, 'Prêt!');
    await sleep(150);
    document.getElementById('boot').style.display = 'none';
    document.getElementById('app').style.display = 'flex';

    const mgCount = S.all.filter(c => c.country === 'MG').length;
    toast(`✅ ${S.all.length.toLocaleString()} chaînes prêtes`, 'ok');
    setupInfiniteScroll();

  } catch (e) {
    console.error(e);
    prog(0, 'Erreur: ' + e.message);
    document.getElementById('bm').style.color = '#ff5566';
  }
}

// ══════════════════════════════════════════════════════════════
// ░░░ UI BUILDERS ░░░
// ══════════════════════════════════════════════════════════════
function buildCL() {
  const el = document.getElementById('cl');
  if (!el) return;
  const q = S.cq.toLowerCase();
  const list = q ? S.countries.filter(c => (CN[c] || c).toLowerCase().includes(q) || c.toLowerCase().includes(q)) : S.countries;

  let h = `<div class="ci ${!S.country ? 'on' : ''}" data-c="">🌍 Tous</div>`;
  list.slice(0, 100).forEach(c => {
    h += `<div class="ci ${S.country === c ? 'on' : ''}" data-c="${c}">${F[c] || '🏳️'} ${CN[c] || c}</div>`;
  });
  el.innerHTML = h;

  el.querySelectorAll('.ci').forEach(b => b.onclick = () => {
    S.country = b.dataset.c || null;
    S.group = null;
    S.dispIdx = 0;
    el.querySelectorAll('.ci').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    document.querySelectorAll('.nb').forEach(x => x.classList.remove('on'));
    applyFilters();
    closeSB();
  });
}

function buildPills() {
  const bar = document.getElementById('pills');
  if (!bar) return;
  if (S.tab === 'events') { bar.innerHTML = ''; return; }

  let gs = S.all.map(c => c.group).filter(Boolean);
  if (S.tab === 'radio') gs = gs.filter(g => /radio/i.test(g));
  else gs = gs.filter(g => !/radio/i.test(g));

  const u = [...new Set(gs)].sort().slice(0, 22);
  let h = '<button class="pill on" data-g="">Toutes</button>';
  u.forEach(g => h += `<button class="pill" data-g="${encodeURIComponent(g)}">${g}</button>`);
  bar.innerHTML = h;

  bar.querySelectorAll('.pill').forEach(b => b.onclick = () => {
    S.group = b.dataset.g ? decodeURIComponent(b.dataset.g) : null;
    S.dispIdx = 0;
    bar.querySelectorAll('.pill').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    applyFilters();
  });
}

function applyFilters() {
  if (S.tab === 'events') { renderEvents(); return; }

  let ch = [...S.all];
  const q = S.q.toLowerCase().trim();

  if (S.view === 'mg') ch = ch.filter(c => c.country === 'MG');
  else if (S.view === 'radio') ch = ch.filter(c => cat(c) === 'radio');
  else if (S.view !== 'all') ch = ch.filter(c => cat(c) === S.view && cat(c) !== 'radio');

  if (S.tab === 'radio') ch = ch.filter(c => cat(c) === 'radio');
  else if (S.tab === 'live' && S.view !== 'radio') ch = ch.filter(c => cat(c) !== 'radio');

  if (S.country) ch = ch.filter(c => c.country === S.country);
  if (S.group) ch = ch.filter(c => c.group === S.group);

  if (q) {
    ch = ch.filter(c => (c.name || '').toLowerCase().includes(q) || (c.group || '').toLowerCase().includes(q) || (c.country || '').toLowerCase().includes(q));
  }

  S.filtered = ch;
  S.dispIdx = 0;

  const labels = {all:'TV Live', mg:'🇲🇬 Madagascar', sport:'⚽ Sport', news:'📰 Actualités', kids:'🧸 Enfants', movies:'🎬 Films TV', music:'🎵 Musique', nature:'🌿 Nature', religion:'⛪ Religion', radio:'📻 Radio'};
  let title = q ? `"${S.q}"` : S.country && S.view !== 'mg' ? (F[S.country] || '') + ' ' + (CN[S.country] || S.country) : (labels[S.view] || 'TV Live');

  document.getElementById('gtitle').textContent = title;
  document.getElementById('gcnt').textContent = ch.length.toLocaleString() + ' chaînes';

  renderGrid(true);
}

function renderGrid(reset) {
  const wrap = document.getElementById('chGrid');
  const sentinel = document.getElementById('sentinel');
  if (reset) {
    wrap.innerHTML = '';
    wrap.className = 'grid';
    document.getElementById('gw').scrollTop = 0;
  }

  const slice = S.filtered.slice(S.dispIdx, S.dispIdx + S.ps);
  S.dispIdx += slice.length;

  if (reset && !slice.length) {
    wrap.innerHTML = '<div class="empty" style="grid-column:1/-1"><span class="mi">search_off</span><p>Aucune chaîne</p></div>';
    if (sentinel) sentinel.style.display = 'none';
    return;
  }

  const frag = document.createDocumentFragment();
  slice.forEach(ch => frag.appendChild(mkCard(ch)));
  wrap.appendChild(frag);

  const hasMore = S.dispIdx < S.filtered.length;
  if (sentinel) {
    sentinel.style.display = hasMore ? 'flex' : 'none';
    if (hasMore) document.getElementById('sentinelTxt').textContent = `${(S.filtered.length - S.dispIdx).toLocaleString()} restantes`;
  }
}

function mkCard(ch) {
  const d = document.createElement('div');
  const isNow = S.currentCh && S.currentCh.id === ch.id;
  d.className = 'card' + (isNow ? ' now' : '');
  d.dataset.id = ch.id;

  const flag = F[ch.country] || '';
  const c = cat(ch);
  const showL = ch.logo && !S.dataSaver;

  d.innerHTML = `
    <div class="ldot"></div>
    ${flag ? `<span class="cflag">${flag}</span>` : ''}
    ${showL ? `<img class="clogo" src="/api/rtm/img?u=${encodeURIComponent(ch.logo)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
    <div class="cfb" style="${showL ? 'display:none' : ''}"><span class="mi">${ICON[c] || 'tv'}</span></div>
    <div class="cname">${ch.name}</div>
    <div class="ctag">${ch.group || ''}</div>
    ${isNow ? '<div class="nowico"><span class="mi">play_circle</span></div>' : ''}
  `;

  d.onclick = () => playTV(ch);
  return d;
}

function renderEvents() {
  const w = document.getElementById('chGrid');
  w.innerHTML = '';
  w.className = 'ev-grid';
  document.getElementById('sentinel').style.display = 'none';
  document.getElementById('gtitle').textContent = '🏟️ Événements Live';
  document.getElementById('gcnt').textContent = S.events.length + ' chaînes sport';

  if (!S.events.length) {
    w.innerHTML = '<div class="empty" style="grid-column:1/-1"><span class="mi">sports_soccer</span><p>Aucun événement</p></div>';
    return;
  }

  const frag = document.createDocumentFragment();
  S.events.forEach(ch => {
    const d = document.createElement('div');
    d.className = 'ev-card';
    d.innerHTML = `
      <div class="ev-cat"><span class="mi" style="font-size:11px">stadium</span> LIVE</div>
      <div class="ev-name">${ch.name}</div>
      <div class="ev-ch">${ch.group || ''}${ch.country ? ' · ' + (CN[ch.country] || ch.country) : ''}</div>
      <div class="ev-live"><span class="mi">circle</span> EN DIRECT</div>
    `;
    d.onclick = () => playTV(ch);
    frag.appendChild(d);
  });
  w.appendChild(frag);
}

// ══════════════════════════════════════════════════════════════
// ░░░ INFINITE SCROLL ░░░
// ══════════════════════════════════════════════════════════════
function setupInfiniteScroll() {
  const sentinel = document.getElementById('sentinel');
  const gw = document.getElementById('gw');
  if (!sentinel || !gw) return;

  const obs = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && !S.scrollLoading && S.dispIdx < S.filtered.length) {
      S.scrollLoading = true;
      requestAnimationFrame(() => {
        renderGrid(false);
        S.scrollLoading = false;
      });
    }
  }, { root: gw, rootMargin: '400px' });
  obs.observe(sentinel);

  gw.addEventListener('scroll', () => {
    if (gw.scrollHeight - gw.scrollTop - gw.clientHeight < 600) {
       if (!S.scrollLoading && S.dispIdx < S.filtered.length) {
          S.scrollLoading = true;
          renderGrid(false);
          S.scrollLoading = false;
       }
    }
  }, { passive: true });
}

// ══════════════════════════════════════════════════════════════
// ░░░ PLAYER ░░░
// ══════════════════════════════════════════════════════════════
let hls = null;
let retryCount = 0;
const MAX_RETRIES = 10;
let _wd = null;

function playTV(ch) {
  S.currentCh = ch;
  retryCount = 0;
  clearTimeout(_wd);

  document.querySelectorAll('.card').forEach(c => c.classList.toggle('now', c.dataset.id === ch.id));

  const pa = document.getElementById('pa');
  pa.classList.add('show');

  const pLogo = document.getElementById('pLogo');
  if (ch.logo) {
    pLogo.src = `/api/rtm/img?u=${encodeURIComponent(ch.logo)}`;
    pLogo.style.display = 'block';
  } else pLogo.style.display = 'none';

  document.getElementById('pName').textContent = ch.name;
  document.getElementById('pMeta').textContent = (ch.group || '') + (ch.country ? ' · ' + (CN[ch.country] || ch.country) : '');

  spinShow(true, 'Connexion...');
  hideErr();
  loadStream(ch.id);
}

function loadStream(id) {
  const v = document.getElementById('vid');
  if (hls) { hls.destroy(); hls = null; }

  v.pause();
  v.src = '';
  v.load();

  const src = `/api/rtm/live?id=${id}`;

  if (Hls.isSupported()) {
    hls = new Hls({
      maxBufferLength: 20,
      maxMaxBufferLength: 60,
      maxBufferSize: 30 * 1000 * 1000,
      startLevel: -1,
      capLevelToPlayerSize: true,
      enableWorker: true,
      nudgeMaxRetry: 5,
      liveSyncDurationCount: 3,
    });
    hls.loadSource(src);
    hls.attachMedia(v);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      v.play().catch(() => {});
      spinShow(false);
      _wdog(v, id);
    });
    hls.on(Hls.Events.ERROR, (e, data) => {
      if (data.fatal) {
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          spinShow(true, `Reconnexion (${retryCount}/${MAX_RETRIES})...`);
          setTimeout(() => loadStream(id), 2000);
        } else {
          spinShow(false);
          showErr();
        }
      }
    });
  } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
    v.src = src;
    v.play().catch(() => {});
    spinShow(false);
  }
}

function _wdog(v, id) {
  clearTimeout(_wd);
  let lastTime = -1;
  let stuckCount = 0;
  function chk() {
    if (!S.currentCh || S.currentCh.id !== id) return;
    if (v.paused || v.ended) return;
    if (v.currentTime === lastTime) {
      if (++stuckCount >= 5 && hls) {
        stuckCount = 0;
        hls.recoverMediaError();
        v.play().catch(() => {});
      }
    } else {
      stuckCount = 0;
    }
    lastTime = v.currentTime;
    _wd = setTimeout(chk, 2000);
  }
  _wd = setTimeout(chk, 5000);
}

function spinShow(on, msg = '') {
  const ps = document.getElementById('pspin');
  if (ps) {
    ps.classList.toggle('gone', !on);
    if (msg) document.getElementById('pmsg').textContent = msg;
  }
}

function showErr() { document.getElementById('perr').style.display = 'flex'; }
function hideErr() { document.getElementById('perr').style.display = 'none'; }
function openSB() { document.getElementById('sb').classList.add('open'); document.getElementById('dov').classList.add('show'); }
function closeSB() { document.getElementById('sb').classList.remove('open'); document.getElementById('dov').classList.remove('show'); }

// ══════════════════════════════════════════════════════════════
// ░░░ EVENTS ░░░
// ══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  boot();

  let st;
  document.getElementById('si').oninput = e => {
    clearTimeout(st);
    st = setTimeout(() => { S.q = e.target.value; S.dispIdx = 0; applyFilters(); }, 300);
  };

  document.getElementById('csi').oninput = e => { S.cq = e.target.value; buildCL(); };

  document.getElementById('retryB').onclick = () => { hideErr(); if (S.currentCh) playTV(S.currentCh); };

  document.getElementById('fsB').onclick = () => {
    const v = document.getElementById('vid');
    if (v.requestFullscreen) v.requestFullscreen();
    else if (v.webkitRequestFullscreen) v.webkitRequestFullscreen();
  };

  document.getElementById('pipB').onclick = async () => {
    const v = document.getElementById('vid');
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch (e) { toast('PiP non supporté', 'err'); }
  };

  document.getElementById('dsB').onclick = () => {
    S.dataSaver = !S.dataSaver;
    document.getElementById('dsB').classList.toggle('on', S.dataSaver);
    toast(S.dataSaver ? '🍃 Mode économie' : '🔋 Mode normal', 'info');
    renderGrid(true);
  };

  document.getElementById('thB').onclick = () => {
    document.body.classList.toggle('light');
    const isLight = document.body.classList.contains('light');
    document.getElementById('thB').querySelector('.mi').textContent = isLight ? 'dark_mode' : 'light_mode';
  };

  document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
    S.tab = b.dataset.tab;
    S.group = null;
    S.dispIdx = 0;
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    buildPills();
    applyFilters();
  });

  document.querySelectorAll('.nb').forEach(b => b.onclick = () => {
    const v = b.dataset.v;
    S.view = v; S.country = null; S.group = null; S.dispIdx = 0;
    document.querySelectorAll('.nb').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    buildCL(); buildPills(); applyFilters(); closeSB();
  });

  document.querySelectorAll('.mnt[data-v]').forEach(b => b.onclick = () => {
    const v = b.dataset.v;
    S.view = v; S.country = null; S.group = null; S.dispIdx = 0;
    document.querySelectorAll('.mnt').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    applyFilters();
  });

  document.getElementById('evBtn').onclick = () => {
    S.tab = 'events'; S.dispIdx = 0;
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('on'));
    document.querySelector('[data-tab="events"]')?.classList.add('on');
    applyFilters();
  };

  document.getElementById('mnuB').onclick = openSB;
  document.getElementById('dov').onclick = closeSB;

  document.getElementById('pa').onclick = () => {
    const pa = document.getElementById('pa');
    pa.classList.add('show');
    clearTimeout(pa._t);
    pa._t = setTimeout(() => pa.classList.remove('show'), 4000);
  };
});
