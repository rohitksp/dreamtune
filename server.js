const express = require('express');
const cors = require('cors');
const path = require('path');
const YouTube = require('youtube-sr').default;

// Optional: only needed for "download for offline" (wishlist)
let ytdl = null;
try { ytdl = require('@distube/ytdl-core'); }
catch (e) { console.warn('[warn] @distube/ytdl-core not installed - offline downloads disabled'); }

const app = express();
app.use(cors());

// Serve the app itself (index.html, music.js, music.css) from this folder.
// IMPORTANT: open http://localhost:3000 in the browser, NOT the index.html file directly.
// Never expose server code or dependencies through the static folder
app.use((req, res, next) => {
    if (/^\/(server\.js|package(-lock)?\.json|node_modules)/i.test(req.path)) return res.status(404).end();
    next();
});
app.use(express.static(__dirname));

// ---------- Search (YouTube-style results) ----------
function formatResult(id, title, artist, duration, views) {
    return { id, title, artist: artist || 'YouTube', duration: duration || '', views: Number(views) || 0,
             thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` };
}

// Primary: youtube-sr library
async function searchWithLibrary(query, limit = 20) {
    const results = await YouTube.search(query, { limit, type: 'video' });
    const list = Array.isArray(results) ? results : (results.videos || []);
    return list.map(v => formatResult(v.id, v.title, v.channel && v.channel.name, v.durationFormatted, v.views));
}

// Fallback: read YouTube's search page directly
async function searchWithScrape(query) {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`;
    const r = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cookie': 'CONSENT=YES+1; SOCS=CAI'
        }
    });
    if (!r.ok) throw new Error('YouTube responded ' + r.status);
    const html = await r.text();
    const m = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
    if (!m) throw new Error('Could not read YouTube results page');
    const data = JSON.parse(m[1]);

    const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
        ?.sectionListRenderer?.contents || [];
    const out = [];
    for (const sec of sections) {
        for (const item of (sec.itemSectionRenderer?.contents || [])) {
            const v = item.videoRenderer;
            if (!v || !v.videoId) continue;
            out.push(formatResult(
                v.videoId,
                v.title?.runs?.map(x => x.text).join('') || 'Untitled',
                v.ownerText?.runs?.[0]?.text,
                v.lengthText?.simpleText,
                parseInt(String(v.viewCountText?.simpleText || '').replace(/\D/g, ''), 10)
            ));
            if (out.length >= 20) return out;
        }
    }
    return out;
}

// Paging: page 1 = results 1-20, page 2 = 21-40 ... (max MAX_PAGES pages)
const PAGE_SIZE = 20;
const MAX_PAGES = 5;
const CACHE_TTL = 10 * 60 * 1000;
const searchCache = new Map();   // query -> { items, time, exhausted }

async function getSearchPage(query, page) {
    const key = query.toLowerCase();
    let entry = searchCache.get(key);
    if (entry && Date.now() - entry.time > CACHE_TTL) { searchCache.delete(key); entry = null; }

    const need = page * PAGE_SIZE;
    if (!entry || (entry.items.length < need && !entry.exhausted)) {
        let items, exhausted = false;
        try {
            items = await searchWithLibrary(query, need);
            if (!items.length) throw new Error('youtube-sr returned nothing');
            exhausted = items.length < need;
        } catch (err1) {
            console.error('[search] youtube-sr failed:', err1.message);
            items = await searchWithScrape(query);   // fallback gives ~20 results only
            exhausted = true;
        }
        const seen = new Set();
        items = items.filter(i => !seen.has(i.id) && seen.add(i.id));
        entry = { items, time: Date.now(), exhausted };
        searchCache.set(key, entry);
    }

    const slice = entry.items.slice((page - 1) * PAGE_SIZE, need);
    const hasMore = page < MAX_PAGES && (entry.items.length > need || !entry.exhausted);
    return { items: slice, hasMore };
}

const inflight = new Map();   // identical searches at the same moment share one YouTube request
function getSearchPageShared(q, p) {
    const k = q.toLowerCase() + '|' + p;
    if (inflight.has(k)) return inflight.get(k);
    const pr = getSearchPage(q, p).finally(() => inflight.delete(k));
    inflight.set(k, pr);
    return pr;
}

app.get('/api/search', async (req, res) => {
    const query = (req.query.q || '').trim();
    const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), MAX_PAGES);
    if (!query) return res.json({ items: [], hasMore: false });

    try {
        res.set('Cache-Control', 'public, max-age=300');
        res.json(await getSearchPageShared(query, page));
    } catch (err) {
        console.error('[search] failed:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ---------- Search suggestions (as-you-type) ----------
app.get('/api/suggest', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    try {
        const r = await fetch(
            `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&oe=utf-8&q=${encodeURIComponent(q)}`
        );
        const data = await r.json();
        res.json(Array.isArray(data[1]) ? data[1].slice(0, 8) : []);
    } catch (err) {
        res.json([]);
    }
});

// ---------- Audio download (for offline wishlist) ----------
app.get('/api/download', async (req, res) => {
    const id = String(req.query.id || '');
    if (!/^[\w-]{11}$/.test(id)) return res.status(400).json({ error: 'Invalid video id' });
    if (!ytdl) return res.status(501).json({ error: 'ytdl-core not installed' });

    try {
        const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${id}`);

        let format;
        try {
            // Prefer m4a/mp4 audio: plays in every browser/WebView
            format = ytdl.chooseFormat(info.formats, {
                quality: 'highestaudio',
                filter: f => f.hasAudio && !f.hasVideo && f.container === 'mp4'
            });
        } catch (e) {
            format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
        }

        res.setHeader('Content-Type', (format.mimeType || 'audio/mp4').split(';')[0]);
        if (format.contentLength) res.setHeader('Content-Length', format.contentLength);

        ytdl.downloadFromInfo(info, { format })
            .on('error', err => { console.error('Download stream error:', err.message); res.destroy(); })
            .pipe(res);
    } catch (err) {
        console.error('Download error:', err.message);
        if (!res.headersSent) res.status(500).json({ error: 'Download failed' });
        else res.destroy();
    }
});

app.listen(3000, () => console.log('DreamTune running -> open http://localhost:3000'));