// RSKIP Explorer: browse, filter and sort Rootstock Improvement Proposals.
//
// Data flow:
//   1. Render instantly from data.json (rebuilt daily by .github/workflows/refresh-data.yml).
//   2. Ask the GitHub API for the repo's file list (1 request) and compare each file's blob SHA
//      with the snapshot. Only new or changed proposals are downloaded, so a normal visit makes
//      2 requests instead of ~230, and stays well inside GitHub's unauthenticated rate limit.
//   3. If GitHub is unreachable or rate-limited, the snapshot stays on screen and the status line says so.
//
// Every value that reaches innerHTML goes through esc(). Upstream markdown is treated as untrusted text.

const REPO = 'rsksmart/RSKIPs';
const BRANCH = 'master';
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
const TREE_API = `https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`;
const TIMEOUT_MS = 10_000;
const MAX_FILE_BYTES = 200_000; // RSKIPs are a few KB; skip anything that isn't plausibly one

const STATUS_ORDER = ['Draft', 'Accepted', 'Active', 'Testnet', 'Adopted', 'Deferred', 'Rejected', 'Withdrawn', 'Superseded', 'Unknown'];
// Status filters. "Adopted" groups Accepted, Active and Adopted; each row still shows its exact status.
const FILTERS = {
  Draft: ['Draft'], Adopted: ['Accepted', 'Active', 'Adopted'], Testnet: ['Testnet'], Deferred: ['Deferred'],
  Rejected: ['Rejected'], Withdrawn: ['Withdrawn'], Superseded: ['Superseded'], Unknown: ['Unknown'],
};
const FILTER_ORDER = Object.keys(FILTERS);
const filterOf = (status) => FILTER_ORDER.find((f) => FILTERS[f].includes(status)) ?? 'Unknown';
const UPCOMING = ['Draft'];
const TONE = { Draft: 'draft', Accepted: 'accepted', Active: 'adopted', Testnet: 'testnet', Adopted: 'adopted' };
const PURPOSE_NAME = { Sca: 'Scalability', Usa: 'Usability', Sec: 'Security', Fair: 'Fairness', ST: 'Standard Track' };
const SORT_KEYS = ['num', 'title', 'status', 'purpose', 'layer', 'complexity', 'created'];
const DESC_FIRST = ['created', 'complexity', 'num'];
const DEFAULTS = { q: '', statuses: UPCOMING, layer: '', complexity: '', sort: 'created', dir: 'desc' };

const EMBEDDED = globalThis.__SNAP ?? null; // set only in the self-contained (offline) build
const { parseRskip, parseAuthorIndex, isRskipFile } = globalThis.RSKIP;

const $ = (id) => document.getElementById(id);
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const tone = (s) => (Object.hasOwn(TONE, s) ? TONE[s] : 'closed');
const rowId = (x) => `d-${x.path.replace(/[^A-Za-z0-9]/g, '-')}`;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const sameSet = (a, b) => a.size === b.size && [...a].every((v) => b.has(v));
const fmtDate = (d) => new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' });

let items = [];
let snapshot = null;
const open = new Set();
const state = { ...DEFAULTS, statuses: new Set(DEFAULTS.statuses) };

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function getJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status === 403 || r.status === 429 ? 'GitHub rate limit reached' : `HTTP ${r.status}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

// Search text is built once per item rather than on every keystroke.
function index(list) {
  for (const x of list) {
    x.hay = [x.num, x.title, ...x.authors.flatMap((a) => [a.name, a.id]), ...x.purpose.map((p) => PURPOSE_NAME[p]), x.layer, x.abstract]
      .join(' ').toLowerCase();
  }
  return list;
}

async function syncWithGitHub() {
  const tree = await getJSON(TREE_API);
  if (tree.truncated) throw new Error('GitHub returned a partial file list');
  const files = new Map(tree.tree
    .filter((t) => t.type === 'blob' && isRskipFile(t.path) && !(t.size > MAX_FILE_BYTES))
    .map((t) => [t.path, t.sha]));
  if (!files.size) throw new Error('No proposals found on GitHub');

  const known = new Map(items.map((x) => [x.path, x]));
  const changed = [...files].filter(([path, sha]) => known.get(path)?.sha !== sha).map(([path]) => path);
  const removed = items.some((x) => !files.has(x.path));
  if (!changed.length && !removed) return false;

  // Author initials live in the README; only re-read it when something changed.
  const readme = tree.tree.find((t) => t.path === 'README.md');
  let names = snapshot?.names ?? {};
  if (changed.length && readme?.sha !== snapshot?.readmeSha) {
    const latest = parseAuthorIndex(await getText(RAW + 'README.md').catch(() => ''));
    if (Object.keys(latest).length) names = latest;
  }

  const fresh = new Map();
  const queue = [...changed];
  const worker = async () => {
    for (let path; (path = queue.shift()); ) {
      try {
        const item = parseRskip(path, (await getText(RAW + path)).slice(0, MAX_FILE_BYTES), names);
        if (Number.isInteger(item.num)) fresh.set(path, { ...item, sha: files.get(path) });
      } catch { /* keep the snapshot copy of this one */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));

  items = index([...files.keys()]
    .map((path) => fresh.get(path) ?? known.get(path))
    .filter(Boolean)
    .sort((a, b) => a.num - b.num || a.path.localeCompare(b.path)));
  return true;
}

function setSource(kind, html) {
  $('dot').className = `dot ${kind}`;
  $('sourceText').innerHTML = html;
}

async function init() {
  readUrl();
  syncControls({ search: true });
  syncTabToHash(true);

  try {
    snapshot = EMBEDDED ?? (await getJSON('data.json'));
    items = index(snapshot.items);
    buildOptions();
    render();
  } catch {
    snapshot = null;
  }

  const repoLink = `<a href="https://github.com/${REPO}" rel="noopener noreferrer" target="_blank">${REPO}</a>`;
  if (EMBEDDED) {
    setSource('live', `Snapshot of ${repoLink} · ${esc(fmtDay(snapshot.generated))}`);
    return;
  }
  if (snapshot) setSource('loading', 'Checking GitHub for changes…');

  try {
    const changed = await syncWithGitHub();
    if (changed) { buildOptions(); render(); }
    setSource('live', `Up to date with ${repoLink} · checked ${esc(fmtDate(Date.now()))}`);
  } catch (e) {
    if (items.length) {
      setSource('', `Showing the saved copy (last changed ${esc(fmtDay(snapshot.generated))}). Couldn't reach GitHub: ${esc(e.message)}.`);
    } else {
      setSource('', 'Could not load proposals.');
      $('rows').innerHTML = `<tr><td colspan="7" class="error">Couldn't reach GitHub. Try again in a minute.</td></tr>`;
    }
  }
}

// ---------------------------------------------------------------------------
// URL state (shareable filtered views)
// ---------------------------------------------------------------------------

function readUrl() {
  const p = new URLSearchParams(location.search);
  // Accepts filter names and exact statuses, so older links (e.g. status=Accepted) keep working.
  if (p.has('status')) state.statuses = new Set((p.get('status') || '').split(',').filter((s) => STATUS_ORDER.includes(s)).map(filterOf));
  if (p.has('q')) state.q = p.get('q').slice(0, 200);
  if (p.has('layer')) state.layer = p.get('layer').slice(0, 40);
  if (['1', '2', '3'].includes(p.get('complexity'))) state.complexity = p.get('complexity');
  const [k, d] = (p.get('sort') || '').split(':');
  if (SORT_KEYS.includes(k)) { state.sort = k; state.dir = d === 'asc' ? 'asc' : 'desc'; }
}

function writeUrl() {
  if (EMBEDDED) return;
  const p = new URLSearchParams();
  if (!sameSet(state.statuses, new Set(UPCOMING))) p.set('status', FILTER_ORDER.filter((f) => state.statuses.has(f)).join(','));
  if (state.q.trim()) p.set('q', state.q.trim());
  for (const k of ['layer', 'complexity']) if (state[k]) p.set(k, state[k]);
  if (`${state.sort}:${state.dir}` !== 'created:desc') p.set('sort', `${state.sort}:${state.dir}`);
  const qs = p.toString();
  try { history.replaceState(null, '', `${qs ? `?${qs}` : location.pathname}${location.hash}`); } catch { /* sandboxed */ }
}

// ---------------------------------------------------------------------------
// Filtering and sorting
// ---------------------------------------------------------------------------

function matches(x, ignoreStatus = false) {
  if (!ignoreStatus && !state.statuses.has(filterOf(x.status))) return false;
  if (state.layer && !x.layer.split(', ').includes(state.layer)) return false;
  if (state.complexity && String(x.complexity) !== state.complexity) return false;
  const q = state.q.trim().toLowerCase().replace(/^rskip[-\s]*/, '');
  if (/^\d+$/.test(q)) return x.num === Number(q); // "559" or "RSKIP-559" means that proposal
  if (q && !q.split(/\s+/).every((w) => x.hay.includes(w))) return false;
  return true;
}

const sortValue = (x, k) => (k === 'status' ? STATUS_ORDER.indexOf(x.status)
  : k === 'purpose' ? x.purpose.map((p) => PURPOSE_NAME[p] ?? p).join(', ')
  : x[k]);
const isBlank = (v) => v === null || v === undefined || v === '' || v === '—';

function compare(a, b) {
  const va = sortValue(a, state.sort), vb = sortValue(b, state.sort);
  if (isBlank(va) !== isBlank(vb)) return isBlank(va) ? 1 : -1; // blanks always last
  const d = state.dir === 'asc' ? 1 : -1;
  const c = typeof va === 'string' ? collator.compare(va, vb) : va - vb;
  return (c || a.num - b.num) * d;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function buildOptions() {
  const layers = [...new Set(items.flatMap((x) => x.layer.split(', ')))].filter((l) => l !== '—').sort();
  if (!layers.includes(state.layer)) state.layer = ''; // ignore unknown values from old or edited links
  $('layer').innerHTML = '<option value="">All categories</option>'
    + layers.map((l) => `<option${l === state.layer ? ' selected' : ''}>${esc(l)}</option>`).join('');
}

function syncControls({ search = false } = {}) {
  if (search) $('q').value = state.q; // never rewrite the box while someone is typing in it
  $('complexity').value = state.complexity;
  $('layer').value = state.layer;
  const sv = `${state.sort}:${state.dir}`;
  $('sortSel').value = [...$('sortSel').options].some((o) => o.value === sv) ? sv : 'custom';
}

const presets = () => {
  const present = FILTER_ORDER.filter((f) => items.some((x) => filterOf(x.status) === f));
  const count = (set) => items.filter((x) => set.includes(filterOf(x.status))).length;
  return [
    { key: 'upcoming', label: 'Upcoming', set: UPCOMING },
    { key: 'adopted', label: 'Adopted', set: ['Adopted'] },
    { key: 'all', label: 'All RSKIPs', set: present },
  ].map((p) => ({ ...p, n: count(p.set), present }));
};

function renderRow(x) {
  const expanded = open.has(x.path);
  const id = rowId(x);
  const url = `https://github.com/${REPO}/blob/${BRANCH}/${encodeURI(x.path)}`;
  const purposes = x.purpose.map((p) => `<span class="tag">${esc(PURPOSE_NAME[p] ?? p)}</span>`).join('') || '<span class="tag">—</span>';
  const cx = x.complexity
    ? `<span class="cxbar" aria-hidden="true">${[1, 2, 3].map((i) => `<i${i <= x.complexity ? ' class="f"' : ''}></i>`).join('')}</span><span class="sr-only">${x.complexity} of 3</span>`
    : '—';
  const row = `<tr class="row">
    <td class="num">#${esc(x.num)}</td>
    <td class="title"><button type="button" class="row-toggle" data-path="${esc(x.path)}" data-focus-key="row-${esc(x.path)}" aria-expanded="${expanded}" aria-controls="${id}">${esc(x.title)}</button><span class="authors">${esc(x.authors.map((a) => a.name).join(', ') || 'Unknown author')}</span></td>
    <td class="status"><span class="badge" data-tone="${tone(x.status)}">${esc(x.status)}</span></td>
    <td class="purpose">${purposes}</td>
    <td class="layer"><span class="tag">${esc(x.layer)}</span></td>
    <td class="cx">${cx}</td>
    <td class="date">${esc(x.created || '—')}</td>
  </tr>`;
  const detail = `<tr class="detail" id="${id}"${expanded ? '' : ' hidden'}><td colspan="7"><p>${esc(x.abstract || 'No abstract found.')}</p><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Read RSKIP-${esc(x.num)} on GitHub →</a></td></tr>`;
  return row + detail;
}

let visible = [];

function render() {
  const focusKey = document.activeElement?.dataset?.focusKey; // restore focus after re-render

  const ps = presets();
  const norm = (set) => [...set].filter((s) => ps[0].present.includes(s)).sort().join();
  const cur = norm(state.statuses);
  for (const p of ps) { // tiles are in the HTML already, so only their numbers and state change (no layout shift)
    const btn = $('stats').querySelector(`[data-preset="${p.key}"]`);
    const on = norm(p.set) === cur;
    btn.querySelector('b').textContent = p.n;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
  }

  const base = items.filter((x) => matches(x, true));
  $('statusChips').innerHTML = ps[0].present.map((s) => {
    const on = state.statuses.has(s);
    return `<button type="button" class="chip${on ? ' on' : ''}" data-s="${esc(s)}" data-tone="${tone(s)}" data-focus-key="chip-${esc(s)}" aria-pressed="${on}">${esc(s)} <span class="n">${base.filter((x) => filterOf(x.status) === s).length}</span></button>`;
  }).join('');

  for (const th of document.querySelectorAll('thead th[data-k]')) {
    const on = th.dataset.k === state.sort;
    if (on) th.setAttribute('aria-sort', state.dir === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
    th.querySelector('.arr').textContent = on ? (state.dir === 'asc' ? '↑' : '↓') : '';
  }

  visible = base.filter((x) => state.statuses.has(filterOf(x.status))).sort(compare);
  $('count').textContent = `${visible.length} of ${items.length} proposals`;
  $('rows').innerHTML = visible.length
    ? visible.map(renderRow).join('')
    : '<tr><td colspan="7" class="empty">No proposals match these filters.</td></tr>';
  paintExpandAll();

  if (focusKey) document.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
}

function paintExpandAll() {
  $('expandAll').textContent = visible.length && visible.every((x) => open.has(x.path)) ? 'Collapse all' : 'Expand all';
}

function toggleRow(btn, force) {
  const path = btn.dataset.path;
  const on = force ?? !open.has(path);
  if (on) open.add(path); else open.delete(path);
  btn.setAttribute('aria-expanded', String(on));
  $(btn.getAttribute('aria-controls')).hidden = !on;
}

function update() { writeUrl(); syncControls(); render(); }

// ---------------------------------------------------------------------------
// Tabs, guide navigation, theme
// ---------------------------------------------------------------------------

// #guide and guide section anchors (#g-…) open the guide; an empty hash opens proposals;
// other anchors (e.g. the skip link's #main) leave the current tab alone.
function syncTabToHash(initial = false) {
  const h = location.hash;
  if (h === '#guide' || h.startsWith('#g-')) {
    showTab('guide');
    if (h.startsWith('#g-') && initial) document.getElementById(h.slice(1))?.scrollIntoView();
  } else if (!h || initial) {
    showTab('proposals');
  }
}

function showTab(name) {
  const guide = name === 'guide';
  $('tab-proposals').hidden = guide;
  $('tab-guide').hidden = !guide;
  for (const [id, on] of [['tabBtn-proposals', !guide], ['tabBtn-guide', guide]]) {
    $(id).setAttribute('aria-selected', String(on));
    $(id).tabIndex = on ? 0 : -1;
  }
}

const root = document.documentElement;
const isDark = () => root.dataset.theme === 'dark';
const paintThemeBtn = () => { $('themeLabel').textContent = isDark() ? 'Light mode' : 'Dark mode'; };

// ---------------------------------------------------------------------------
// Events (delegated, bound once)
// ---------------------------------------------------------------------------

let debounce;
$('q').addEventListener('input', (e) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => { state.q = e.target.value.slice(0, 200); update(); }, 150);
});
$('layer').addEventListener('change', (e) => { state.layer = e.target.value; update(); });
$('complexity').addEventListener('change', (e) => { state.complexity = e.target.value; update(); });
$('sortSel').addEventListener('change', (e) => {
  const [k, d] = e.target.value.split(':');
  if (SORT_KEYS.includes(k)) { state.sort = k; state.dir = d === 'asc' ? 'asc' : 'desc'; update(); }
});

$('stats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-preset]');
  if (!b) return;
  state.statuses = new Set(presets().find((p) => p.key === b.dataset.preset).set);
  update();
});

$('statusChips').addEventListener('click', (e) => {
  const c = e.target.closest('[data-s]');
  if (!c) return;
  const s = c.dataset.s;
  if (!Object.hasOwn(FILTERS, s)) return;
  if (e.altKey || e.metaKey) state.statuses = new Set([s]); // Alt/Cmd-click: show only this status
  else if (!state.statuses.delete(s)) state.statuses.add(s);
  update();
});

document.querySelector('thead').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-k]');
  if (!th) return;
  const k = th.dataset.k;
  if (state.sort === k) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
  else { state.sort = k; state.dir = DESC_FIRST.includes(k) ? 'desc' : 'asc'; }
  update();
});

$('rows').addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  const btn = e.target.closest('tr.row')?.querySelector('.row-toggle');
  if (btn) { toggleRow(btn); paintExpandAll(); }
});

$('expandAll').addEventListener('click', () => {
  const all = visible.every((x) => open.has(x.path));
  for (const btn of $('rows').querySelectorAll('.row-toggle')) toggleRow(btn, !all);
  paintExpandAll();
});

$('reset').addEventListener('click', () => {
  Object.assign(state, DEFAULTS, { statuses: new Set(DEFAULTS.statuses) });
  syncControls({ search: true });
  update();
});

// "/" focuses search, like GitHub.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest('input, select, textarea, [contenteditable]')) return;
  if ($('tab-proposals').hidden) return;
  e.preventDefault();
  $('q').focus();
});

const tabs = [...document.querySelectorAll('[role=tab]')];
for (const [i, b] of tabs.entries()) {
  b.addEventListener('click', () => {
    const name = b.dataset.tab;
    try { history.replaceState(null, '', location.pathname + location.search + (name === 'guide' ? '#guide' : '')); } catch { /* sandboxed */ }
    showTab(name);
    window.scrollTo({ top: 0 });
  });
  b.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: tabs.length - 1 - i }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = tabs[(i + step + tabs.length) % tabs.length];
    next.focus();
    next.click();
  });
}
window.addEventListener('hashchange', () => syncTabToHash());

// Guide contents are real #g-… links (deep-linkable, and they move keyboard focus); this just highlights the current one.
const tocLinks = [...document.querySelectorAll('#toc a')];
const tocObserver = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (en.isIntersecting) for (const a of tocLinks) a.classList.toggle('on', a.hash === `#${en.target.id}`);
  }
}, { rootMargin: '-10% 0px -70% 0px' });
for (const s of document.querySelectorAll('.guide-body > section')) tocObserver.observe(s);

// Theme: the initial value is set by the inline script in <head> (light unless the viewer chose dark).
$('themeBtn').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('rskip-theme', next); } catch { /* storage blocked */ }
  paintThemeBtn();
});
paintThemeBtn();

init();
