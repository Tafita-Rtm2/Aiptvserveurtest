'use strict';

// ══════════════════════════════════════════════════════════════
// ░░░ CONFIG & ÉTAT ░░░
// ══════════════════════════════════════════════════════════════
const TMDB_BASE = 'https://image.themoviedb.org/t/p/';
const IMG_SIZE = 'w342';
const IMG_ORIG = 'original';

let currentTab = 'movies';
let heroItems = [], heroIdx = 0, heroTimer = null;
let currentItem = null, currentSeason = 1, currentEp = 1;
let vipToken = sessionStorage.getItem('vt') || null;
let pendingDlId = null;

// Infinite scroll
let infPage = 1, infLoading = false, infDone = false, infEndpoint = '', infType = 'movie';

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
function imgUrl(path, size = IMG_SIZE) {
  if (!path) return '';
  return '/api/rtm/img?u=' + encodeURIComponent(TMDB_BASE + size + path);
}

async function apiFetch(path) {
  const r = await fetch('/api/rtm' + path.replace('/api/rtm', ''));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

function prog(p, m) {
  const bf = document.getElementById('bf');
  const bm = document.getElementById('bm');
  if (bf) bf.style.width = p + '%';
  if (bm) bm.textContent = m;
}

// ══════════════════════════════════════════════════════════════
// ░░░ BOOT & TABS ░░░
// ══════════════════════════════════════════════════════════════
async function boot() {
  prog(10, 'Connexion...');
  try {
    prog(30, 'Chargement...');
    await loadTab('movies');
    prog(100, 'Prêt!');
    setTimeout(() => {
      document.getElementById('boot').style.display = 'none';
      document.getElementById('app').style.display = 'block';
    }, 200);
  } catch (e) {
    prog(0, 'Erreur: ' + e.message);
  }
}

async function loadTab(tab) {
  currentTab = tab;
  infDone = true; // Stop infinite scroll if active
  const content = document.getElementById('mainContent');
  content.innerHTML = '<div style="text-align:center;padding:50px"><div class="ring"></div></div>';

  let sections = [];
  if (tab === 'movies') {
    const [tr, pop, top] = await Promise.all([
      apiFetch('/movies/trending'), apiFetch('/movies/popular'), apiFetch('/movies/top')
    ]);
    setHero(tr.results || []);
    sections = [
      { title: '🔥 Tendances', icon: 'local_fire_department', items: tr.results, type: 'movie', endpoint: '/movies/trending' },
      { title: '⭐ Populaires', icon: 'star', items: pop.results, type: 'movie', endpoint: '/movies/popular' },
      { title: '🏆 Mieux Notés', icon: 'emoji_events', items: top.results, type: 'movie', endpoint: '/movies/top' }
    ];
  } else if (tab === 'tv') {
    const [tr, pop] = await Promise.all([apiFetch('/tv/trending'), apiFetch('/tv/popular')]);
    setHero(tr.results || []);
    sections = [
      { title: '🔥 Séries Tendance', icon: 'local_fire_department', items: tr.results, type: 'tv', endpoint: '/tv/trending' },
      { title: '⭐ Séries Populaires', icon: 'star', items: pop.results, type: 'tv', endpoint: '/tv/popular' }
    ];
  }
  renderSections(sections);
}

// ══════════════════════════════════════════════════════════════
// ░░░ HERO & RENDU ░░░
// ══════════════════════════════════════════════════════════════
function setHero(items) {
  heroItems = items.filter(i => i.backdrop_path).slice(0, 5);
  if (!heroItems.length) return;
  heroIdx = 0;
  updateHeroContent(0);
}

function updateHeroContent(idx) {
  const item = heroItems[idx];
  document.getElementById('heroImg0').src = imgUrl(item.backdrop_path, IMG_ORIG);
  document.getElementById('htitle').textContent = item.title || item.name;
  document.getElementById('hdesc').textContent = item.overview;
  const type = item.title ? 'movie' : 'tv';
  document.getElementById('hplay').onclick = () => openPlayer(item, type);
  document.getElementById('hinfo').onclick = () => openInfo(item, type);
}

function renderSections(sections) {
  const c = document.getElementById('mainContent');
  c.innerHTML = '';
  sections.forEach(sec => {
    const s = document.createElement('div');
    s.className = 'section';
    s.innerHTML = `
      <div class="sec-hdr">
        <div class="sec-title"><span class="mi">${sec.icon}</span>${sec.title}</div>
        <div class="see-all" onclick="showInfinite('${sec.title}', '${sec.endpoint}', '${sec.type}')">
          <span class="mi">arrow_forward_ios</span>
        </div>
      </div>
      <div class="row"></div>
    `;
    const row = s.querySelector('.row');
    (sec.items || []).slice(0, 15).forEach(item => row.appendChild(mkCard(item, sec.type)));
    c.appendChild(s);
  });
}

function mkCard(item, type) {
  const d = document.createElement('div');
  d.className = 'mc';
  const poster = imgUrl(item.poster_path, 'w342');
  d.innerHTML = `
    <div class="mc-poster">
      <img src="${poster}" loading="lazy" alt="">
      <div class="mc-ov"><div class="mc-play"><span class="mi">play_arrow</span></div></div>
    </div>
    <div class="mc-info">
      <div class="mc-title">${item.title || item.name}</div>
      <div class="mc-meta">${(item.release_date || item.first_air_date || '').substring(0, 4)}</div>
    </div>
  `;
  d.onclick = () => openInfo(item, type);
  return d;
}

// ══════════════════════════════════════════════════════════════
// ░░░ INFINITE SCROLL ░░░
// ══════════════════════════════════════════════════════════════
function showInfinite(title, endpoint, type) {
  infEndpoint = endpoint; infType = type; infPage = 1; infDone = false;
  const c = document.getElementById('mainContent');
  c.innerHTML = `
    <div class="bc"><span class="bl" onclick="loadTab(currentTab)">Accueil</span> <span class="mi">chevron_right</span> <span class="cur">${title}</span></div>
    <div class="inf-grid" id="infGrid"></div>
    <div id="infSentinel" style="height:20px"></div>
  `;
  loadMore();
  setupInfiniteObserver();
}

async function loadMore() {
  if (infLoading || infDone) return;
  infLoading = true;
  try {
    const url = infEndpoint + (infEndpoint.includes('?') ? '&' : '?') + 'page=' + infPage;
    const data = await apiFetch(url);
    const results = data.results || [];
    if (!results.length) { infDone = true; return; }
    const grid = document.getElementById('infGrid');
    results.forEach(item => grid.appendChild(mkCard(item, infType)));
    infPage++;
  } catch (e) { infDone = true; }
  finally { infLoading = false; }
}

function setupInfiniteObserver() {
  const obs = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) loadMore();
  }, { rootMargin: '500px' });
  const sentinel = document.getElementById('infSentinel');
  if (sentinel) obs.observe(sentinel);
}

// ══════════════════════════════════════════════════════════════
// ░░░ MODALS & PLAYER ░░░
// ══════════════════════════════════════════════════════════════
async function openInfo(item, type) {
  currentItem = { ...item, _type: type };
  const m = document.getElementById('infoModal');
  m.classList.add('open');
  document.getElementById('infoTitle').textContent = item.title || item.name;
  document.getElementById('infoPoster').src = imgUrl(item.poster_path, 'w342');
  document.getElementById('infoOverview').textContent = item.overview;

  try {
    const det = await apiFetch(`/${type === 'movie' ? 'movies' : 'tv'}/details?token=${item.streamToken || ''}`);
    // Update more details if needed
    currentItem.streamToken = det.streamToken;
  } catch (e) {}

  document.getElementById('infoPlay').onclick = () => { m.classList.remove('open'); openPlayer(currentItem, type); };
}

async function openPlayer(item, type) {
  const m = document.getElementById('modal');
  m.classList.add('open');
  document.getElementById('pbTitle').textContent = item.title || item.name;

  let token = item.streamToken;
  if (!token) {
     const det = await apiFetch(`/${type === 'movie' ? 'movies' : 'tv'}/details?token=${btoa(JSON.stringify({type, id:item.id}))}`);
     token = det.streamToken;
  }

  loadEmbed(token);
}

function loadEmbed(token, s = 1, ep = 1) {
  const f = document.getElementById('pFrame');
  const loader = document.getElementById('pLoad');
  loader.style.display = 'flex';
  f.style.display = 'none';

  f.src = `/api/rtm/embed?token=${token}&s=${s}&ep=${ep}`;
  f.onload = () => {
    loader.style.display = 'none';
    f.style.display = 'block';
  };
}

// ══════════════════════════════════════════════════════════════
// ░░░ INIT ░░░
// ══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  boot();

  document.getElementById('pbClose').onclick = () => {
    document.getElementById('modal').classList.remove('open');
    document.getElementById('pFrame').src = '';
  };

  document.querySelectorAll('.nt').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.nt').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      loadTab(btn.dataset.tab);
    };
  });

  document.getElementById('infoClose').onclick = () => document.getElementById('infoModal').classList.remove('open');
  document.getElementById('infoClose2').onclick = () => document.getElementById('infoModal').classList.remove('open');
});
