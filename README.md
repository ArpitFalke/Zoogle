# Zoogle 🔍

A Google-inspired search engine that runs entirely on your machine with **zero npm dependencies** — just Node.js 18+.

Search anything, any website. Results come live from the real web:

| Feature | Source |
|---|---|
| Web results (with real URLs, snippets, result counts) | Bing HTML index |
| Autocomplete suggestions | DuckDuckGo |
| Image search (free-to-use media) | Openverse |
| News tab | Google News RSS |
| Knowledge panel | Wikipedia |
| "I'm Feeling Lucky" | jumps straight to the #1 result |

## Run it

```bash
cd search-engine
node server.js        # or: npm start
```

Then open **http://localhost:3000**

## Features

- Google-style homepage with colored logo, autocomplete dropdown and recent searches (stored locally)
- Results page with favicons, site breadcrumbs, snippets, result count + timing
- **Goooooogle pagination** — the classic colored-o's page navigation
- Tabs: All / Images / News (Google's `tbm=isch` / `tbm=nws` URL convention)
- Wikipedia knowledge panel on the right
- "People also search for" related queries
- `I'm Feeling Lucky` redirect
- Dark mode (auto-detects system theme, toggle persisted)
- Voice search (Chromium browsers), `/` keyboard shortcut to focus the search box
- `site:` and other search operators pass straight through to the index
- 10-minute server-side cache so repeated searches are instant

## API

```
GET /api/search?q=<query>&page=<n>   → web results
GET /api/suggest?q=<prefix>          → autocomplete
GET /api/images?q=<query>&page=<n>   → image results
GET /api/news?q=<query>              → news results
GET /api/knowledge?q=<query>         → Wikipedia summary
GET /lucky?q=<query>                 → 302 to first result
```

## Notes

Upstream engines rate-limit aggressively repeated automated queries. If the web tab
returns an error, wait a moment and retry — the cache means a repeat of the same
query is served instantly.
