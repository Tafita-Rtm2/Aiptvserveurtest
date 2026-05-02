'use strict';

// ══════════════════════════════════════════════════════════════
// ░░░ ÉTAT GLOBAL ░░░
// ══════════════════════════════════════════════════════════════
const S = {
  all: [],
  filtered: [],
  countries: [],
  groups: [],
  currentCh: null,
  currentFilter: 'all',
  searchTerm: '',
  dispIdx: 0,
  pageSize: 60,
  scrollLoading: false,
  dataSaver: false,
};

// Drapeaux pays
const F = {
  'MG':'🇲🇬','FR':'🇫🇷','RE':'🇷🇪','MU':'🇲🇺','US':'🇺🇸','GB':'🇬🇧',
  'ES':'🇪🇸','IT':'🇮🇹','DE':'🇩🇪','BR':'🇧🇷','CA':'🇨🇦','JP':'🇯🇵',
  'CN':'🇨🇳','IN':'🇮🇳','AR':'🇦🇷','AU':'🇦🇺','BE':'🇧🇪','CH':'🇨🇭',
};

// Noms pays
const CN = {
  'MG':'Madagascar','FR':'France','RE':'Réunion','MU':'Maurice','US':'USA','GB':'UK',
  'ES':'Espagne','IT':'Italie','DE':'Allemagne','BR':'Brésil','CA':'Canada',
};

// Icônes catégories
const ICON = {
  news:'newspaper',sport:'sports_soccer',movies:'movie',music:'music_note',
  kids:'child_care',general:'tv',entertainment:'theaters',religious:'church',
};

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
// ░░░ TOAST NOTIFICATIONS ░░░
// ══════════════════════════════════════════════════════════════
function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  const icon = type === 'error' ? 'error' : type === 'success' ? 'check_circle' : 'info';
  t.innerHTML = `<span class="mi">${icon}</span><div class="toast-msg">${msg}</div>`;
  const container = document.getElementById('toasts');
  if (container) {
    container.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }
}

// ══════════════════════════════════════════════════════════════
// ░░░ CHARGEMENT INITIAL DES CHAÎNES ░░░
// ══════════════════════════════════════════════════════════════
async function loadChannels() {
  try {
    const gcnt = document.getElementById('gcnt');
    if (gcnt) gcnt.textContent = 'Connexion au serveur...';

    const res = await fetch('/api/rtm/channels?limit=50000');
    if (!res.ok) throw new Error('Network error');

    const data = await res.json();
    S.all = data.channels || [];

    if (S.all.length === 0) throw new Error('Aucune chaîne disponible');

    const [resC, resG] = await Promise.all([
      fetch('/api/rtm/countries'),
      fetch('/api/rtm/groups')
    ]);

    const [dataC, dataG] = await Promise.all([resC.json(), resG.json()]);
    S.countries = dataC.countries || [];
    S.groups = dataG.groups || [];

    renderPills();
    applyFilters();

    toast(`${S.all.length} chaînes prêtes`, 'success');

  } catch (e) {
    console.error('Boot error:', e);
    toast('Erreur de chargement', 'error');
    const gcnt = document.getElementById('gcnt');
    if (gcnt) gcnt.textContent = 'Erreur';
  }
}

// ══════════════════════════════════════════════════════════════
// ░░░ RENDU PILLS (FILTRES) ░░░
// ══════════════════════════════════════════════════════════════
function renderPills() {
  const w = document.getElementById('pills');
  if (!w) return;
  w.innerHTML = '';

  const pAll = document.createElement('div');
  pAll.className = 'pill active';
  pAll.innerHTML = '<span class="mi">tv</span> Toutes';
  pAll.onclick = (e) => setFilter('all', null, e.target);
  w.appendChild(pAll);

  S.countries.slice(0, 15).forEach(c => {
    const p = document.createElement('div');
    p.className = 'pill';
    p.innerHTML = `${F[c] || ''} ${CN[c] || c}`;
    p.onclick = (e) => setFilter('country', c, e.currentTarget);
    w.appendChild(p);
  });
}

function setFilter(type, value, el) {
  S.currentFilter = type === 'all' ? 'all' : `${type}:${value}`;
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
  if (el) el.classList.add('active');
  applyFilters();
}

function applyFilters() {
  let list = [...S.all];
  if (S.currentFilter !== 'all') {
    const [type, val] = S.currentFilter.split(':');
    if (type === 'country') list = list.filter(ch => ch.country === val);
  }

  if (S.searchTerm) {
    const q = S.searchTerm.toLowerCase();
    list = list.filter(ch => ch.name.toLowerCase().includes(q) || (ch.group || '').toLowerCase().includes(q));
  }

  S.filtered = list;
  S.dispIdx = 0;

  const wrap = document.getElementById('chGrid');
  if (wrap) wrap.innerHTML = '';
  const gw = document.getElementById('gw');
  if (gw) gw.scrollTop = 0;

  const gtitle = document.getElementById('gtitle');
  if (gtitle) {
    gtitle.textContent = S.searchTerm ? `🔍 Recherche` :
                        S.currentFilter === 'all' ? `📺 Toutes les chaînes` :
                        `📺 ${S.currentFilter.split(':')[1]}`;
  }

  const gcnt = document.getElementById('gcnt');
  if (gcnt) gcnt.textContent = `${S.filtered.length.toLocaleString()} chaînes`;

  renderGrid(true);
}

// ══════════════════════════════════════════════════════════════
// ░░░ RENDU GRID AVEC SCROLL INFINI ░░░
// ══════════════════════════════════════════════════════════════
function renderGrid(reset = false) {
  const wrap = document.getElementById('chGrid');
  if (!wrap) return;
  const sentinel = document.getElementById('sentinel');

  if (reset) {
    wrap.innerHTML = '';
    S.dispIdx = 0;
  }

  const slice = S.filtered.slice(S.dispIdx, S.dispIdx + S.pageSize);
  S.dispIdx += slice.length;

  if (reset && slice.length === 0) {
    wrap.innerHTML = '<div class="empty"><span class="mi">search_off</span><p>Aucun résultat</p></div>';
    if (sentinel) sentinel.style.display = 'none';
    return;
  }

  const frag = document.createDocumentFragment();
  slice.forEach(ch => frag.appendChild(makeCard(ch)));
  wrap.appendChild(frag);

  const hasMore = S.dispIdx < S.filtered.length;
  if (sentinel) {
    sentinel.style.display = hasMore ? 'flex' : 'none';
    const sentTxt = document.getElementById('sentinelTxt');
    if (sentTxt && hasMore) sentTxt.textContent = `${(S.filtered.length - S.dispIdx).toLocaleString()} restantes`;
  }
}

function makeCard(ch) {
  const d = document.createElement('div');
  const isNow = S.currentCh && S.currentCh.id === ch.id;
  d.className = 'card' + (isNow ? ' now' : '');
  d.dataset.id = ch.id;

  const flag = F[ch.country] || '';
  const showLogo = ch.logo && !S.dataSaver;
  const cat = (ch.group || '').toLowerCase();
  const icon = Object.keys(ICON).find(k => cat.includes(k)) || 'general';

  d.innerHTML = `
    ${flag ? `<span class="cflag">${flag}</span>` : ''}
    ${showLogo ?
      `<img class="clogo" src="/api/rtm/img?u=${encodeURIComponent(ch.logo)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ''}
    <div class="cfb" style="${showLogo ? 'display:none' : ''}"><span class="mi">${ICON[icon]}</span></div>
    <div class="cname">${ch.name}</div>
    <div class="ctag">${ch.group || ''}</div>
    ${isNow ? '<div class="nowico"><span class="mi">play_circle</span></div>' : ''}
  `;

  d.onclick = () => playTV(ch);
  return d;
}

// ══════════════════════════════════════════════════════════════
// ░░░ INFINITE SCROLL ░░░
// ══════════════════════════════════════════════════════════════
function setupInfiniteScroll() {
  const sentinel = document.getElementById('sentinel');
  if (!sentinel) return;

  const obs = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting && !S.scrollLoading && S.dispIdx < S.filtered.length) {
      S.scrollLoading = true;
      setTimeout(() => {
        renderGrid(false);
        S.scrollLoading = false;
      }, 100);
    }
  }, { root: document.getElementById('gw'), rootMargin: '400px' });
  obs.observe(sentinel);
}

// ══════════════════════════════════════════════════════════════
// ░░░ PLAYER HLS ULTRA-OPTI ░░░
// ══════════════════════════════════════════════════════════════
let hls = null;
let retryCount = 0;
const MAX_RETRIES = 10;

function playTV(ch) {
  S.currentCh = ch;
  document.querySelectorAll('.card').forEach(c => c.classList.toggle('now', c.dataset.id === ch.id));

  document.getElementById('player').style.display = 'flex';
  document.getElementById('pinfo').style.display = 'flex';
  document.getElementById('pCtrls').style.display = 'flex';
  document.getElementById('pname').textContent = ch.name;
  document.getElementById('pgroup').textContent = `${ch.group || ''} ${ch.country ? '· '+(CN[ch.country]||ch.country) : ''}`;

  const plogo = document.getElementById('plogo');
  if (ch.logo) {
    plogo.src = `/api/rtm/img?u=${encodeURIComponent(ch.logo)}`;
    plogo.style.display = 'block';
  } else plogo.style.display = 'none';

  loadStream(ch.id);
}

function loadStream(id) {
  if (hls) { hls.destroy(); hls = null; }
  const video = document.getElementById('pvideo');
  const status = document.getElementById('pstatus');
  video.src = '';
  status.textContent = 'Connexion...';

  // Nouvelle route sécurisée par ID
  const src = `/api/rtm/live?id=${id}`;

  if (Hls.isSupported()) {
    hls = new Hls({
      maxBufferLength: 15,       // Réduit pour économiser data (default 30)
      maxBufferSize: 30*1000*1000, // 30MB max buffer
      startLevel: 0,             // Commence en basse qualité
      capLevelToPlayerSize: true,
      enableWorker: true,
    });
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(() => {});
      status.textContent = '🔴 EN DIRECT';
      retryCount = 0;
    });
    hls.on(Hls.Events.ERROR, (e, data) => {
      if (data.fatal) {
        if (retryCount < MAX_RETRIES) {
          retryCount++;
          status.textContent = `Reconnexion (${retryCount})...`;
          setTimeout(() => loadStream(id), 2000);
        } else {
          status.textContent = '⚠️ Flux indisponible';
        }
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;
    video.play().catch(() => {});
  }
}

// ══════════════════════════════════════════════════════════════
// ░░░ INITIALISATION ░░░
// ══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  loadChannels();
  setupInfiniteScroll();

  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', e => {
      S.searchTerm = e.target.value.trim();
      applyFilters();
    });
  }

  const clearSearch = document.getElementById('clearSearch');
  if (clearSearch) {
    clearSearch.onclick = () => {
      searchInput.value = '';
      S.searchTerm = '';
      applyFilters();
    };
  }

  document.getElementById('pclose').onclick = () => {
    document.getElementById('player').style.display = 'none';
    if (hls) { hls.destroy(); hls = null; }
    document.getElementById('pvideo').src = '';
    S.currentCh = null;
    document.querySelectorAll('.card').forEach(c => c.classList.remove('now'));
  };

  document.getElementById('pRetry').onclick = () => {
    if (S.currentCh) loadStream(S.currentCh.id);
  };
});
