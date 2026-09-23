/* Parses RSKIP markdown files from rsksmart/RSKIPs. Works in browser and Node. */
(function (root) {
  const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  const PURPOSES = { SCA: 'Sca', USA: 'Usa', SEC: 'Sec', FAIR: 'Fair', ST: 'ST' };
  const pad = (n) => String(n).padStart(2, '0');
  const yr = (y) => { y = +y; return y < 100 ? 2000 + y : y; };

  function parseDate(raw) {
    const s = (raw || '').trim().replace(/\//g, '-').replace(/-+$/, '');
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) return `${m[1]}-${pad(m[2])}`;
    if ((m = s.match(/^(\d{4})$/))) return m[1];
    if ((m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/)) && MONTHS[m[2].toUpperCase()])
      return `${yr(m[3])}-${pad(MONTHS[m[2].toUpperCase()])}-${pad(m[1])}`;
    if ((m = s.match(/^([A-Za-z]{3})-(\d{1,2})-(\d{4})$/)) && MONTHS[m[1].toUpperCase()])
      return `${m[3]}-${pad(MONTHS[m[1].toUpperCase()])}-${pad(m[2])}`;
    return '';
  }

  function frontMatter(text) {
    const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
    const out = {};
    if (!m) return out;
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
      if (kv) out[kv[1].toLowerCase()] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
    }
    return out;
  }

  function metaTable(text) {
    const out = {};
    const re = /^\|\s*\*\*([A-Za-z ]+)\*\*\s*\|\s*([^|]*)\|/gm;
    let m;
    while ((m = re.exec(text))) out[m[1].trim().toLowerCase()] = m[2].trim();
    return out;
  }

  const isPlaceholder = (v) => !v || /\bor\b/.test(v) || /DD-MMM/.test(v);

  function stripMd(s) {
    return s
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[*_`#>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function abstractOf(text) {
    const m = text.match(/^#{1,3}\s*(Abstract|Summary|Motivation)\s*\n([\s\S]*?)(?=^#{1,3}\s|(?![\s\S]))/im);
    let body = m ? m[2] : text.replace(/^---[\s\S]*?---/, '').replace(/^\|.*$/gm, '').replace(/^#.*$/gm, '');
    body = stripMd(body);
    return body.length > 480 ? body.slice(0, 477).replace(/\s\S*$/, '') + '…' : body;
  }

  function parseAuthors(raw, names) {
    if (isPlaceholder(raw)) return [];
    return raw
      .replace(/\([^)]*\)/g, '').replace(/<[^>]*>/g, '')
      .split(/,|&|\band\b|\//)
      .map((a) => a.trim())
      .filter(Boolean)
      .map((a) => ({ id: a, name: names[a.toUpperCase()] || a }));
  }

  function parseRskip(path, text, names) {
    names = names || {};
    const fm = frontMatter(text);
    const tb = metaTable(text);
    const get = (k) => { const v = fm[k] || tb[k] || ''; return isPlaceholder(v) ? '' : v; };
    const num = parseInt(fm.rskip || (path.match(/RSKIP0*(\d+)/i) || [])[1], 10);
    const h1 = (text.match(/^#\s+(.+)$/m) || [])[1] || '';
    let title = get('title') || h1.replace(/^RSKIP-?\s*\d+\s*[:\-–]\s*/i, '');
    let status = get('status').replace(/\s+/g, ' ').trim();
    status = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
    const purpose = [...new Set(get('purpose').split(/[,\s]+/).map((p) => PURPOSES[p.toUpperCase()]).filter(Boolean))];
    const layer = get('layer').split(/[,\s]+/).filter(Boolean).map((l) => l.charAt(0).toUpperCase() + l.slice(1)).join(', ') || '—';
    const complexity = parseInt(get('complexity'), 10) || null;
    return {
      num,
      title: stripMd(title) || `RSKIP ${num}`,
      status,
      purpose,
      layer,
      complexity,
      created: parseDate(get('created')),
      authors: parseAuthors(get('author'), names),
      abstract: abstractOf(text),
      path,
    };
  }

  function parseAuthorIndex(readme) {
    const names = {};
    const idx = readme.indexOf('# Author Index');
    if (idx < 0) return names;
    const re = /^\|\s*([A-Z]{2,5})\s*\|\s*([^|]+?)\s*\|/gm;
    const part = readme.slice(idx);
    let m;
    while ((m = re.exec(part))) if (m[1] !== 'Initials') names[m[1]] = m[2];
    return names;
  }

  const isRskipFile = (p) => /^IPs\/RSKIP\d+\.md$/i.test(p);

  const api = { parseRskip, parseAuthorIndex, parseDate, isRskipFile };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RSKIP = api;
})(this);
