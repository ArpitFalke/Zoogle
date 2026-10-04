/* =============================== Zoogle app =============================== */
"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const homeView = $("#home-view");
const resultsView = $("#results-view");
const resultsMain = $("#results-main");
const knowledgePanel = $("#knowledge-panel");
const progressBar = $("#progress-bar");
const toastEl = $("#toast");

const MAX_RECENT = 10;
const RECENT_KEY = "zoogle_recent";
const THEME_KEY = "zoogle_theme";

/* --------------------------------- helpers -------------------------------- */

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg, ms = 2600) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (toastEl.hidden = true), ms);
}

function timeAgo(dateStr) {
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)} minutes ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hours ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function urlParts(url) {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean).slice(0, 3).map(decodeURIComponent);
    return { host: u.hostname.replace(/^www\./, ""), path: segs.length ? " › " + segs.join(" › ") : "" };
  } catch { return { host: "", path: "" }; }
}

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/* ---------------------------------- theme --------------------------------- */

const sunSVG = `<svg viewBox="0 0 24 24"><path fill="#5f6368" d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5v3m0 14v3M4.2 4.2l2.2 2.2m11.2 11.2 2.2 2.2M2 12h3m14 0h3M4.2 19.8l2.2-2.2M17.6 6.4l2.2-2.2" stroke="#5f6368" stroke-width="2" stroke-linecap="round"/></svg>`;
const moonSVG = `<svg viewBox="0 0 24 24"><path fill="#e8eaed" d="M12.3 2a9.9 9.9 0 0 0-2.6.4 10 10 0 0 0 .1 19.2 10 10 0 0 0 11.3-14.9A10 10 0 0 0 12.3 2zm1.5 2.6a7.5 7.5 0 0 1 3.4 1.6 7.4 7.4 0 0 1-8.4 11.7 7.4 7.4 0 0 1 5-13.3z"/></svg>`;

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#theme-toggle-home").innerHTML = theme === "dark" ? sunSVG : moonSVG;
  $("#theme-toggle-results").innerHTML = theme === "dark" ? sunSVG : moonSVG;
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const theme = saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(theme);
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

/* ----------------------------- recent searches ---------------------------- */

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; }
  catch { return []; }
}

function addRecent(q) {
  const list = [q, ...getRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())];
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
}

/* ---------------------------------- router -------------------------------- */

let state = { q: "", tab: "web", page: 1 };
let reqToken = 0;

function parseLocation() {
  const sp = new URLSearchParams(location.search);
  const tab = sp.get("tbm") === "isch" ? "isch" : sp.get("tbm") === "nws" ? "nws" : "web";
  return {
    q: (sp.get("q") || "").trim(),
    tab,
    page: Math.max(1, parseInt(sp.get("page") || "1", 10) || 1),
  };
}

function buildURL(s) {
  if (!s.q) return "/";
  const sp = new URLSearchParams({ q: s.q });
  if (s.tab === "isch") sp.set("tbm", "isch");
  if (s.tab === "nws") sp.set("tbm", "nws");
  if (s.page > 1) sp.set("page", String(s.page));
  return `/?${sp.toString()}`;
}

function navigate(s, replace = false) {
  const url = buildURL(s);
  if (replace) history.replaceState(s, "", url);
  else history.pushState(s, "", url);
  render();
}

function doSearch(q, tab = state.tab || "web") {
  q = (q || "").trim();
  if (!q) { toast("Type something to search"); return; }
  addRecent(q);
  closeAllDropdowns();
  navigate({ q, tab, page: 1 });
}

/* -------------------------------- rendering ------------------------------- */

function render() {
  state = parseLocation();
  const isResults = !!state.q;
  homeView.hidden = isResults;
  resultsView.hidden = !isResults;
  document.title = isResults ? `${state.q} - Zoogle Search` : "Zoogle";

  if (!isResults) {
    $("#home-input").value = "";
    $("#home-clear").hidden = true;
    knowledgePanel.innerHTML = "";
    setTimeout(() => $("#home-input").focus(), 0);
    return;
  }

  $("#results-input").value = state.q;
  $("#results-clear").hidden = false;
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  $("#footer-time").textContent = new Date().toLocaleTimeString();
  window.scrollTo(0, 0);

  if (state.tab === "web") loadWeb();
  else if (state.tab === "isch") loadImages();
  else loadNews();
}

function progressOn() { progressBar.classList.add("on"); }
function progressOff() { progressBar.classList.remove("on"); }

function spinner() {
  return `<div class="spinner" role="status" aria-label="Loading"></div>`;
}

function errorBox(msg) {
  return `<div class="state-box"><h2>Something went wrong</h2>
    <p class="dim">${esc(msg)} — the upstream search engine may be rate-limiting. Try again in a moment.</p></div>`;
}

/* ------------------------------ web results ------------------------------- */

async function loadWeb() {
  const token = ++reqToken;
  progressOn();
  resultsMain.innerHTML = spinner();
  knowledgePanel.innerHTML = "";

  try {
    const [search, knowledge] = await Promise.all([
      getJSON(`/api/search?q=${encodeURIComponent(state.q)}&page=${state.page}`),
      state.page === 1
        ? getJSON(`/api/knowledge?q=${encodeURIComponent(state.q)}`).catch(() => null)
        : null,
    ]);
    if (token !== reqToken) return;

    let html = "";
    if (search.results && search.results.length) {
      html += `<p class="stats-line">About ${search.count.toLocaleString()} results${search.approximate ? "" : ""} (${search.time} seconds)</p>`;
      html += search.results.map(resultHTML).join("");
      if (state.page === 1) html += await relatedHTML();
    } else {
      html = emptyStateHTML(state.q);
    }
    html += paginationHTML(Math.min(10, Math.ceil((search.count || 30) / 10)));
    resultsMain.innerHTML = html;
    renderKnowledge(knowledge);
  } catch (e) {
    if (token === reqToken) resultsMain.innerHTML = errorBox(e.message);
  } finally {
    progressOff();
  }
}

function resultHTML(r) {
  const { host, path } = urlParts(r.url);
  const letter = esc((host[0] || "w").toUpperCase());
  const fav = `https://icons.duckduckgo.com/ip3/${esc(host)}.ico`;
  return `
  <div class="result">
    <div class="result-top">
      <div class="result-favicon"><span style="font-weight:700;font-size:14px;color:#1a73e8">${letter}</span>
        <img src="${esc(fav)}" alt="" loading="lazy" onerror="this.remove()"></div>
      <div class="result-site">
        <div class="site-name">${esc(host)}</div>
        ${path ? `<div class="site-url">${esc(host + path)}</div>` : ""}
      </div>
    </div>
    <h3><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.title)}</a></h3>
    <p class="snippet">${esc(r.snippet)}</p>
  </div>`;
}

function emptyStateHTML(q) {
  return `<div class="state-box">
    <h2>Your search - <em>${esc(q)}</em> - did not match any documents.</h2>
    <ul>
      <li>Make sure all words are spelled correctly.</li>
      <li>Try different keywords.</li>
      <li>Try more general keywords.</li>
      <li>Try fewer keywords.</li>
    </ul>
  </div>`;
}

async function relatedHTML() {
  try {
    const sugg = await getJSON(`/api/suggest?q=${encodeURIComponent(state.q)}`);
    const items = (sugg || []).slice(0, 8);
    if (!items.length) return "";
    const arrow = `<svg viewBox="0 0 24 24"><path fill="#5f6368" d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/></svg>`;
    return `<div class="related-block"><h4>People also search for</h4><div class="related-grid">
      ${items.map((s) =>
        `<a class="related-item" href="${esc(buildURL({ q: s, tab: "web", page: 1 }))}">${arrow}<span>${esc(s)}</span></a>`).join("")}
    </div></div>`;
  } catch { return ""; }
}

function renderKnowledge(k) {
  if (!k || !k.found) { knowledgePanel.innerHTML = ""; return; }
  knowledgePanel.innerHTML = `
    <div class="kp-card">
      <div class="kp-head">
        ${k.thumbnail ? `<img src="${esc(k.thumbnail)}" alt="${esc(k.title)}" onerror="this.remove()">` : ""}
        <div class="kp-body">
          <h2 class="kp-title">${esc(k.title)}</h2>
          ${k.description ? `<div class="kp-sub">${esc(k.description)}</div>` : ""}
        </div>
      </div>
      <p class="kp-extract" style="margin-top:10px">${esc(k.extract)}</p>
      ${k.url ? `<a class="kp-more" href="${esc(k.url)}" target="_blank" rel="noopener">Read more on Wikipedia &raquo;</a>` : ""}
    </div>`;
}

/* Goooooogle-style pagination: pages 2..N rendered as colored o's */
function paginationHTML(maxPage) {
  if (state.tab === "nws") return "";
  const colors = ["pg-r", "pg-y", "pg-b", "pg-g"];
  let html = `<div class="pagination">`;
  if (state.page === 1) {
    html += `<span class="pg-cur">1</span> <span class="pg-b" style="font-family:Poppins;font-weight:600;font-size:17px">G</span>`;
  } else {
    html += `<a class="pg pg-b" href="${buildURL({ ...state, page: 1 })}">1</a> <span class="pg-b" style="font-family:Poppins;font-weight:600;font-size:17px">G</span>`;
  }
  for (let p = 2; p <= maxPage; p++) {
    if (p === state.page) {
      html += `<span class="pg-cur" title="Page ${p}" style="font-family:Poppins;font-size:17px">o</span>`;
    } else {
      html += `<a class="pg ${colors[p % colors.length]}" title="Page ${p}" href="${buildURL({ ...state, page: p })}">o</a>`;
    }
  }
  html += `<span style="font-family:Poppins;font-weight:600;font-size:17px" class="pg-b">g</span><span style="font-family:Poppins;font-weight:600;font-size:17px" class="pg-g">l</span><span style="font-family:Poppins;font-weight:600;font-size:17px" class="pg-r">e</span>`;
  if (state.page < maxPage) {
    html += `<a class="pg-next" href="${buildURL({ ...state, page: state.page + 1 })}">Next &gt;</a>`;
  }
  html += `</div>`;
  return html;
}

/* -------------------------------- images tab ------------------------------ */

async function loadImages() {
  const token = ++reqToken;
  progressOn();
  resultsMain.innerHTML = spinner();
  knowledgePanel.innerHTML = "";

  try {
    const imgs = await getJSON(`/api/images?q=${encodeURIComponent(state.q)}&page=${state.page}`);
    if (token !== reqToken) return;

    if (imgs && imgs.length) {
      const grid = imgs.map((im) => `
        <figure class="img-tile" style="margin:0">
          <img src="${esc(im.thumbnail)}" alt="${esc(im.title)}" loading="lazy"
               onerror="this.closest('.img-tile').remove()"
               data-page="${esc(im.pageUrl)}">
          <figcaption class="img-overlay">${esc(im.title)}</figcaption>
          <div class="img-meta">${esc(im.source || "")}${im.license ? " · " + esc(im.license.toUpperCase()) : ""}</div>
        </figure>`).join("");
      resultsMain.innerHTML = `
        <p class="stats-line">Images for <b>${esc(state.q)}</b> — via Openverse, free-to-use media</p>
        <div class="images-grid">${grid}</div>
        ${paginationHTML(Math.min(10, state.page + 6))}`;
      $$("#results-main .images-grid img").forEach((img) =>
        img.addEventListener("click", () => window.open(img.dataset.page, "_blank", "noopener")));
    } else {
      resultsMain.innerHTML = emptyStateHTML(state.q);
    }
  } catch (e) {
    if (token === reqToken) resultsMain.innerHTML = errorBox(e.message);
  } finally {
    progressOff();
  }
}

/* --------------------------------- news tab ------------------------------- */

async function loadNews() {
  const token = ++reqToken;
  progressOn();
  resultsMain.innerHTML = spinner();
  knowledgePanel.innerHTML = "";

  try {
    const news = await getJSON(`/api/news?q=${encodeURIComponent(state.q)}`);
    if (token !== reqToken) return;

    if (news && news.length) {
      resultsMain.innerHTML = `
        <div class="news-list">
          <p class="stats-line">News for <b>${esc(state.q)}</b> — via Google News</p>
          ${news.map((n) => `
            <article class="news-item">
              <a href="${esc(n.link)}" target="_blank" rel="noopener">
                <div class="news-src">${esc(n.source || "News")}<span class="dot"></span>${esc(timeAgo(n.pubDate))}</div>
                <h3 class="news-title">${esc(n.title)}</h3>
              </a>
            </article>`).join("")}
        </div>`;
    } else {
      resultsMain.innerHTML = emptyStateHTML(state.q);
    }
  } catch (e) {
    if (token === reqToken) resultsMain.innerHTML = errorBox(e.message);
  } finally {
    progressOff();
  }
}

/* --------------------------- search box component ------------------------- */

const magSVG = `<svg viewBox="0 0 24 24"><path fill="#9aa0a6" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 0 0 1.48-5.34c-.47-2.78-2.79-5-5.59-5.34a6.505 6.505 0 0 0-7.27 7.27c.34 2.8 2.56 5.12 5.34 5.59a6.5 6.5 0 0 0 5.34-1.48l.27.28v.79l4.25 4.25c.41.41 1.08.41 1.49 0 .41-.41.41-1.08 0-1.49L15.5 14zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`;
const clockSVG = `<svg viewBox="0 0 24 24"><path fill="#5f6368" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0.5 5H11v6l5.2 3.1.8-1.3-4.5-2.7V7z"/></svg>`;

function wireSearchBox({ inputSel, clearSel, ddSel, onSearch }) {
  const input = $(inputSel);
  const clearBtn = $(clearSel);
  const dd = $(ddSel);
  let items = [];        // {text, kind}
  let active = -1;
  let debounceT = null;

  const close = () => { dd.hidden = true; active = -1; };
  const isOpen = () => !dd.hidden;

  function open() {
    const v = input.value.trim();
    items = v
      ? items.filter(Boolean)
      : getRecent().map((r) => ({ text: r, kind: "recent" }));
    if (!items.length && !v) { close(); return; }
    if (!items.length && v) { close(); return; }
    renderDD(v);
    dd.hidden = false;
    active = -1;
  }

  function renderDD(query) {
    const match = query.toLowerCase();
    let rows = "";
    if (!query) {
      rows = items.slice(0, 6).map((it, i) =>
        `<div class="suggest-row" data-i="${i}">${clockSVG}<span class="s-text">${esc(it.text)}</span></div>`).join("");
      if (rows) rows += `<div class="suggest-sep"></div>`;
    } else {
      rows = items.map((it, i) => {
        const t = esc(it.text);
        const bold = match && it.text.toLowerCase().startsWith(match)
          ? `<b>${esc(it.text.slice(0, query.length))}</b>${esc(it.text.slice(query.length))}` : t;
        return `<div class="suggest-row" data-i="${i}">${magSVG}<span class="s-text">${bold}</span></div>`;
      }).join("");
    }
    dd.innerHTML = rows;
    $$("#" + dd.id + " .suggest-row").forEach((row) => {
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const it = items[+row.dataset.i];
        if (it) onSearch(it.text);
      });
    });
  }

  input.addEventListener("input", () => {
    clearBtn.hidden = !input.value;
    const v = input.value.trim();
    clearTimeout(debounceT);
    if (!v) { items = []; open(); return; }
    debounceT = setTimeout(async () => {
      try {
        const sugg = await getJSON(`/api/suggest?q=${encodeURIComponent(v)}`);
        items = (sugg || []).slice(0, 9).map((s) => ({ text: s, kind: "sugg" }));
        open();
      } catch { /* keep silent */ }
    }, 170);
  });

  input.addEventListener("focus", () => {
    const v = input.value.trim();
    if (!v) { items = []; open(); }
  });

  input.addEventListener("keydown", (e) => {
    const rows = $$("#" + dd.id + " .suggest-row");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!isOpen() || !rows.length) return;
      e.preventDefault();
      active += e.key === "ArrowDown" ? 1 : -1;
      if (active >= rows.length) active = 0;
      if (active < 0) active = rows.length - 1;
      rows.forEach((r, i) => r.classList.toggle("active", i === active));
    } else if (e.key === "Enter") {
      const chosen = active >= 0 && items[active] ? items[active].text : input.value;
      onSearch(chosen);
    } else if (e.key === "Escape") {
      close();
      input.blur();
    }
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    clearBtn.hidden = true;
    close();
    input.focus();
  });

  document.addEventListener("click", (e) => {
    if (!dd.contains(e.target) && e.target !== input) close();
  });

  return { input, close };
}

const homeBox = wireSearchBox({
  inputSel: "#home-input", clearSel: "#home-clear", ddSel: "#home-suggest",
  onSearch: (q) => doSearch(q, "web"),
});
const resultsBox = wireSearchBox({
  inputSel: "#results-input", clearSel: "#results-clear", ddSel: "#results-suggest",
  onSearch: (q) => {
    if (q.trim() && q.trim() !== state.q) doSearch(q, state.tab);
    else resultsBox.close(); // same query again: just close the dropdown
  },
});

function closeAllDropdowns() {
  homeBox.close();
  resultsBox.close();
}

/* ------------------------------- interactions ----------------------------- */

$("#home-search-btn").addEventListener("click", () => doSearch(homeBox.input.value, "web"));

$("#home-lucky-btn").addEventListener("click", () => {
  let q = homeBox.input.value.trim();
  if (!q) {
    const ideas = ["what is the meaning of life", "open source search engine", "hubble telescope images", "how do magnets work"];
    q = ideas[Math.floor(Math.random() * ideas.length)];
    homeBox.input.value = q;
  }
  addRecent(q);
  location.href = `/lucky?q=${encodeURIComponent(q)}`;
});

$("#results-search-btn").addEventListener("click", () => {
  const q = resultsBox.input.value.trim();
  if (q) doSearch(q, state.tab);
});

$$(".tab-btn").forEach((btn) =>
  btn.addEventListener("click", () => {
    if (btn.dataset.tab !== state.tab) navigate({ q: state.q, tab: btn.dataset.tab, page: 1 });
  }));

$("#results-logo").addEventListener("click", (e) => {
  e.preventDefault();
  history.pushState({}, "", "/");
  render();
});

$("#theme-toggle-home").addEventListener("click", toggleTheme);
$("#theme-toggle-results").addEventListener("click", toggleTheme);

$$("[data-example]").forEach((chip) =>
  chip.addEventListener("click", () => { homeBox.input.value = chip.dataset.example; doSearch(chip.dataset.example, "web"); }));

$$("[data-home-link]").forEach((b) =>
  b.addEventListener("click", () => toast("Just a design homage — this page is the whole app 🙂")));

/* "/" focuses the search box, Google-style */
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    e.preventDefault();
    const target = state.q ? resultsBox.input : homeBox.input;
    target.focus();
    target.select();
  }
});

/* voice search (Chromium) */
(function initVoice() {
  const mic = $("#home-mic");
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { mic.style.display = "none"; return; }
  mic.addEventListener("click", () => {
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    toast("Listening…");
    rec.onresult = (ev) => {
      const text = ev.results[0][0].transcript;
      homeBox.input.value = text;
      doSearch(text, "web");
    };
    rec.onerror = () => toast("Voice search unavailable");
    rec.start();
  });
})();

window.addEventListener("popstate", render);

/* ---------------------------------- boot ---------------------------------- */

initTheme();
render();
