#!/usr/bin/env node
/**
 * Zoogle — a Google-inspired metasearch engine.
 * Zero dependencies: Node 18+ (built-in fetch).
 *
 * Data sources (all free, no API keys):
 *   - Web results ......... Bing HTML results page (scraped + parsed)
 *   - Autocomplete ........ DuckDuckGo suggestion endpoint
 *   - Images .............. Openverse API
 *   - News ................ Google News RSS
 *   - Knowledge panel ..... Wikipedia REST summary
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL, URLSearchParams } = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/* ---------------------------------------------------------------- utils */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const buf = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(buf);
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x27;|&#039;/g, "'").replace(/&#x2F;/g, '/')
    .replace(/&(?:[a-z]+|#\d+);/gi, ' ');
}

function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

async function fetchWithTimeout(url, opts = {}, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
        ...(opts.headers || {}),
      },
      ...opts,
    });
  } finally {
    clearTimeout(t);
  }
}

/* Small TTL cache so repeat/paginated searches are instant and upstream-friendly. */
const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_MAX = 300;

async function cached(key, producer) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.v;
  const v = await producer();
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { v, t: Date.now() });
  return v;
}

/* ------------------------------------------------------- web search (Bing) */

function bingUrlFromRedirect(href) {
  const clean = decodeEntities(href);
  const m = clean.match(/[?&]u=a1([A-Za-z0-9_-]+)/);
  if (!m) return clean.startsWith('http') ? clean : null;
    let b = m[1];
    b += '='.repeat((4 - (b.length % 4)) % 4);
  try {
    const url = Buffer.from(b, 'base64url').toString('utf8');
    return /^https?:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

function parseBing(html) {
  const results = [];
  const blocks = html.split(/<li class="b_algo"/).slice(1);
  for (const raw of blocks) {
    const blk = raw.split(/<li class="b_algo"|<\/ol>/)[0];
    const tm = blk.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!tm) continue;
    const url = bingUrlFromRedirect(tm[1]);
    if (!url) continue;
    const title = stripTags(tm[2]);
    let snippet = '';
    const cap = blk.match(/<div class="b_caption"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<div class="b_attribution")/);
    const scope = cap ? cap[1] : blk;
    const pm = scope.match(/<(?:p|div class="b_lineClamp[^"]*")[^>]*>([\s\S]*?)<\/(?:p|div)>/);
    if (pm) snippet = stripTags(pm[1]);
    results.push({ title, url, snippet });
  }
  const cm = html.match(/<span class="sb_count"[^>]*>([\s\S]*?)<\/span>/);
  let count = null;
  if (cm) {
    const nums = stripTags(cm[1]).replace(/,/g, '').match(/\d+/g);
    if (nums) count = Math.max(...nums.map(Number));
  }
  return { results, count };
}

async function webSearch(q, page) {
  const first = (page - 1) * 10 + 1;
  return cached(`web:${q}:${page}`, async () => {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(q)}&first=${first}&count=10&setmkt=en-US`;
    const resp = await fetchWithTimeout(url);
    const html = await resp.text();
    return parseBing(html);
  });
}

/* ------------------------------------------------------------- suggestions */

async function suggest(q) {
  return cached(`sug:${q}`, async () => {
    const resp = await fetchWithTimeout(
      `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`);
    const data = await resp.json();
    return Array.isArray(data) && Array.isArray(data[1]) ? data[1].slice(0, 10) : [];
  });
}

/* ------------------------------------------------------------------ images */

async function openverseImages(q, page) {
  // Openverse caps anonymous page_size at 20; fetch two pages in parallel for a full grid.
  const url = (p) =>
    `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=20&page=${p}`;
  const map = (d) => (d.results || []).map(r => ({
    title: r.title || 'Image',
    thumbnail: r.thumbnail || (r.url && r.url.endsWith('.jpg') ? r.url : undefined),
    pageUrl: r.foreign_landing_url,
    imageUrl: r.url,
    source: r.source,
    license: r.license,
  })).filter(r => r.thumbnail);
  const resps = await Promise.allSettled([
    fetchWithTimeout(url(page), {}, 8000),
    fetchWithTimeout(url(page + 1), {}, 8000),
  ]);
  const out = [];
  for (const r of resps) {
    if (r.status === 'fulfilled' && r.value.ok) {
      try { out.push(...map(await r.value.json())); } catch { /* partial ok */ }
    }
  }
  return out;
}

async function commonsImages(q, page) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search`
    + `&gsrsearch=${encodeURIComponent('filetype:bitmap ' + q)}&gsrnamespace=6&gsrlimit=40`
    + `&gsroffset=${(page - 1) * 40}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=400`;
  const resp = await fetchWithTimeout(url, {}, 15000);
  if (!resp.ok) return [];
  const d = await resp.json();
  const pages = Object.values((d.query && d.query.pages) || {});
  return pages.map(p => {
    const ii = p.imageinfo && p.imageinfo[0];
    if (!ii) return null;
    return {
      title: String(p.title || 'Image').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
      thumbnail: ii.thumburl || ii.url,
      pageUrl: ii.descriptionurl,
      imageUrl: ii.url,
      source: 'wikimedia',
      license: (ii.extmetadata && ii.extmetadata.LicenseShortName &&
        ii.extmetadata.LicenseShortName.value || '').toLowerCase().split(' ')[0],
    };
  }).filter(Boolean);
}

/* Circuit breaker: when Openverse is throttling (hangs/401s), go straight to Commons for 10 min. */
let openverseDownUntil = 0;

async function imageSearch(q, page) {
  return cached(`img:${q}:${page}`, async () => {
    let out = [];
    let ovFailed = false;
    if (Date.now() > openverseDownUntil) {
      try {
        out = await openverseImages(q, page);
        if (!out.length) ovFailed = true;
      } catch { ovFailed = true; }
      if (ovFailed) openverseDownUntil = Date.now() + 10 * 60 * 1000;
    }
    if (out.length < 4) {
      try { out = out.concat(await commonsImages(q, page)); } catch { /* keep what we have */ }
    }
    return out;
  });
}

/* -------------------------------------------------------------------- news */

function parseNewsRss(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < 30) {
    const it = m[1];
    const pick = (tag) => {
      const t = it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return t ? decodeEntities(t[1]).trim() : '';
    };
    let title = pick('title');
    let source = pick('source');
    if (!source && title.includes(' - ')) {
      const parts = title.split(' - ');
      source = parts.pop();
      title = parts.join(' - ');
    }
    const link = pick('link');
    const pubDate = pick('pubDate');
    if (title && link) items.push({ title, link, source, pubDate });
  }
  return items;
}

async function newsSearch(q) {
  return cached(`news:${q}`, async () => {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
    const resp = await fetchWithTimeout(url);
    return parseNewsRss(await resp.text());
  });
}

/* -------------------------------------------------------- knowledge (wiki) */

async function knowledge(q) {
  return cached(`kno:${q}`, async () => {
    const tries = [
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q.replace(/ /g, '_'))}`,
      null, // filled below with the opensearch hit
    ];
    const summaryUrl = async (u) => {
      const r = await fetchWithTimeout(u);
      if (!r.ok) return null;
      const d = await r.json();
      if (!d.extract || d.type === 'disambiguation') return null;
      return {
        found: true,
        title: d.title,
        extract: d.extract,
        thumbnail: d.thumbnail && d.thumbnail.source,
        url: d.content_urls && d.content_urls.desktop && d.content_urls.desktop.page,
        description: d.description || '',
      };
    };
    let out = await summaryUrl(tries[0]);
    if (!out) {
      const os = await fetchWithTimeout(
        `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=1&search=${encodeURIComponent(q)}`);
      if (os.ok) {
        const arr = await os.json();
        if (arr[1] && arr[1][0]) out = await summaryUrl(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(arr[1][0].replace(/ /g, '_'))}`);
      }
    }
    return out || { found: false };
  });
}

/* ------------------------------------------------------------ static files */

function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(full)] || 'application/octet-stream');
  });
}

/* ------------------------------------------------------------------ router */

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;
  const qp = u.searchParams;
  const q = (qp.get('q') || '').trim();
  const page = Math.min(Math.max(parseInt(qp.get('page') || '1', 10) || 1, 1), 50);

  try {
    if (p === '/api/search') {
      if (!q) return send(res, 400, { error: 'missing q' });
      const started = Date.now();
      const { results, count } = await webSearch(q, page);
      send(res, 200, {
        query: q, page,
        count: count || (page - 1) * 10 + results.length * 3,
        approximate: !count,
        time: ((Date.now() - started) / 1000).toFixed(2),
        results,
      });
    } else if (p === '/api/suggest') {
      if (!q) return send(res, 200, []);
      send(res, 200, await suggest(q));
    } else if (p === '/api/images') {
      if (!q) return send(res, 400, { error: 'missing q' });
      send(res, 200, await imageSearch(q, Math.min(page, 20)));
    } else if (p === '/api/news') {
      if (!q) return send(res, 400, { error: 'missing q' });
      send(res, 200, await newsSearch(q));
    } else if (p === '/api/knowledge') {
      if (!q) return send(res, 400, { error: 'missing q' });
      send(res, 200, await knowledge(q));
    } else if (p === '/lucky') {
      if (!q) return send(res, 302, { Location: '/' });
      const { results } = await webSearch(q, 1).catch(() => ({ results: [] }));
      res.writeHead(302, { Location: results[0] ? results[0].url : `/?q=${encodeURIComponent(q)}` });
      res.end();
    } else if (p.startsWith('/api/')) {
      send(res, 404, { error: 'unknown endpoint' });
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(req, res, p);
    } else {
      send(res, 405, { error: 'method not allowed' });
    }
  } catch (err) {
    console.error(`[error] ${p}?${qp.toString()} ->`, err.message);
    send(res, 502, { error: 'upstream search failed, try again' });
  }
});

server.listen(PORT, () => {
  console.log(`Zoogle search engine running → http://localhost:${PORT}`);
});
