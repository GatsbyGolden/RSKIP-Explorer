/* RSKIP markdown parser. Shared by the browser (globalThis.RSKIP) and build-snapshot.js (require).
 *
 * Input is untrusted text from a public repo, so the parser:
 *  - works line by line with bounded regexes (no patterns that can backtrack quadratically),
 *  - caps every input and field length,
 *  - uses null-prototype objects for keys that come from the file ("__proto__" stays a plain key),
 *  - returns plain text only; HTML escaping happens at render time.
 */
(function (root) {
  'use strict';

  const MAX_TEXT = 200_000;  // whole file
  const MAX_LINE = 2_000;    // any single line
  const MAX_FIELD = 500;     // any header value

  const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  const PURPOSES = { SCA: 'Sca', USA: 'Usa', SEC: 'Sec', FAIR: 'Fair', ST: 'ST' };
  // Known layers (RSKIP-0). Some headers put purpose codes in the Layer field; those are dropped.
  const LAYERS = { CORE: 'Core', NODE: 'Node', NET: 'Net', UI: 'UI', '2ND': '2nd', DAPP: 'DApp', MISC: 'Misc' };
  // Status spellings seen upstream, normalised case-insensitively. Anything else becomes "Unknown".
  const STATUSES = {
    'draft': 'Draft', 'accepted': 'Accepted', 'active': 'Active', 'adopted': 'Adopted',
    'adopted (testnet)': 'Testnet', 'testnet': 'Testnet', 'deferred': 'Deferred', 'rejected': 'Rejected',
    'withdrawn': 'Withdrawn', 'superseded': 'Superseded', 'replaced': 'Superseded',
  };

  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const pad = (n) => String(n).padStart(2, '0');
  const fullYear = (y) => (Number(y) < 100 ? 2000 + Number(y) : Number(y));
  const lines = (text) => text.slice(0, MAX_TEXT).split(/\r?\n/).map((l) => l.slice(0, MAX_LINE));

  // Template leftovers such as "Draft,Accepted,Adopted,Deferred or Rejected", "1, 2 or 3" or "DD-MMM-YY".
  const isPlaceholder = (v) => !v || (/,/.test(v) && /\sor\s/.test(v)) || /^DD-MMM/i.test(v) || /^<[^>]*>$/.test(v);

  function parseDate(raw) {
    const s = String(raw || '').trim().slice(0, 40).replace(/\//g, '-').replace(/-+$/, '');
    let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    if ((m = /^(\d{4})-(\d{1,2})$/.exec(s))) return `${m[1]}-${pad(m[2])}`;
    if ((m = /^(\d{4})$/.exec(s))) return m[1];
    if ((m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(s)) && own(MONTHS, m[2].toUpperCase()))
      return `${fullYear(m[3])}-${pad(MONTHS[m[2].toUpperCase()])}-${pad(m[1])}`;
    if ((m = /^([A-Za-z]{3})-(\d{1,2})-(\d{4})$/.exec(s)) && own(MONTHS, m[1].toUpperCase()))
      return `${m[3]}-${pad(MONTHS[m[1].toUpperCase()])}-${pad(m[2])}`;
    return '';
  }

  // YAML-style front matter between the first two "---" lines.
  function frontMatter(ls) {
    const out = Object.create(null);
    if (ls[0]?.trim() !== '---') return out;
    for (let i = 1; i < ls.length && ls[i].trim() !== '---'; i++) {
      const m = /^([A-Za-z_-]{1,40}):[ \t]*(.*)$/.exec(ls[i]);
      if (m) out[m[1].toLowerCase()] = m[2].trim().slice(0, MAX_FIELD).replace(/^(["'])(.*)\1$/, '$2');
    }
    return out;
  }

  // Older proposals use a "| **Field** | value |" table instead of front matter.
  function metaTable(ls) {
    const out = Object.create(null);
    for (const l of ls) {
      const m = /^\|[ \t]*\*\*([A-Za-z ]{1,40})\*\*[ \t]*\|([^|]*)\|/.exec(l);
      if (m) out[m[1].trim().toLowerCase()] = m[2].trim().slice(0, MAX_FIELD);
    }
    return out;
  }

  function stripMd(s) {
    return s
      .replace(/```[^`]{0,20000}```/g, ' ')
      .replace(/!\[[^\]\n]{0,300}\]\([^)\n]{0,500}\)/g, '')
      .replace(/\[([^\]\n]{0,300})\]\([^)\n]{0,500}\)/g, '$1')
      .replace(/<[^<>\n]{0,300}>/g, '')
      .replace(/[*_`#>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Text under the first Abstract/Summary/Motivation heading, else the first prose in the file.
  function abstractOf(ls) {
    const isHeading = (l) => l.startsWith('#'); // some files omit the space: "#Title"
    const start = ls.findIndex((l) => /^#{1,3}\s*(abstract|summary|motivation)\b/i.test(l));
    const body = [];
    if (start >= 0) {
      for (let i = start + 1; i < ls.length && !isHeading(ls[i]); i++) body.push(ls[i]);
    } else {
      let inFm = ls[0]?.trim() === '---';
      for (let i = inFm ? 1 : 0; i < ls.length && body.length < 60; i++) {
        if (inFm) { if (ls[i].trim() === '---') inFm = false; continue; }
        if (!isHeading(ls[i]) && !ls[i].startsWith('|')) body.push(ls[i]);
      }
    }
    const text = stripMd(body.join('\n').slice(0, 8_000));
    return text.length > 480 ? `${text.slice(0, 477).replace(/\s\S*$/, '')}…` : text;
  }

  function parseAuthors(raw, names) {
    if (isPlaceholder(raw)) return [];
    return raw
      .slice(0, MAX_FIELD)
      .replace(/\([^()\n]{0,200}\)/g, '')
      .replace(/<[^<>\n]{0,200}>/g, '')
      .split(/,|&|\band\b|\//)
      .map((a) => a.trim())
      .filter(Boolean)
      .slice(0, 20)
      .map((id) => ({ id, name: (own(names, id.toUpperCase()) && names[id.toUpperCase()]) || id }));
  }

  function parseRskip(path, text, names = {}) {
    const ls = lines(String(text));
    const fm = frontMatter(ls);
    const tb = metaTable(ls);
    const get = (k) => { const v = fm[k] || tb[k] || ''; return isPlaceholder(v) ? '' : v; };

    const fileNum = Number((/RSKIP0*(\d{1,6})\.md$/i.exec(path) || [])[1]);
    const headerNum = /^\d{1,6}$/.test(fm.rskip || '') ? Number(fm.rskip) : NaN;
    const num = Number.isInteger(headerNum) ? headerNum : fileNum;

    const h1 = (ls.find((l) => /^#[^#]/.test(l)) || '').slice(1).trim().replace(/^RSKIP-?\s?\d{1,6}\s?[:\-–]\s*/i, '');
    const title = stripMd(get('title') || h1).slice(0, 200) || `RSKIP ${num}`;

    const rawStatus = get('status').replace(/\s+/g, ' ').trim().toLowerCase();
    const status = own(STATUSES, rawStatus) ? STATUSES[rawStatus] : 'Unknown';

    const codes = (v, map) => [...new Set(v.split(/[,\s]+/).map((p) => p.toUpperCase()).filter((p) => own(map, p)).map((p) => map[p]))];
    const complexity = Number(get('complexity'));

    return {
      num,
      title,
      status,
      purpose: codes(get('purpose'), PURPOSES),
      layer: codes(get('layer'), LAYERS).join(', ') || '—',
      complexity: [1, 2, 3].includes(complexity) ? complexity : null,
      created: parseDate(get('created')),
      authors: parseAuthors(get('author'), names),
      abstract: abstractOf(ls),
      path,
    };
  }

  // "| SDL | Sergio Demian Lerner | email |" rows under "# Author Index" in the README.
  function parseAuthorIndex(readme) {
    const names = Object.create(null);
    const ls = lines(String(readme));
    const start = ls.findIndex((l) => /^#+\s*Author Index/i.test(l));
    if (start < 0) return names;
    for (const l of ls.slice(start + 1)) {
      if (/^#/.test(l)) break;
      const cells = l.split('|').map((c) => c.trim());
      if (cells.length >= 3 && /^[A-Z]{2,5}$/.test(cells[1]) && cells[2]) names[cells[1]] = cells[2].slice(0, 100);
    }
    return names;
  }

  const isRskipFile = (p) => /^IPs\/RSKIP\d{1,6}\.md$/i.test(p);

  const api = Object.freeze({ parseRskip, parseAuthorIndex, parseDate, isRskipFile });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RSKIP = api;
})(globalThis);
