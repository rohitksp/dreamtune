// DreamTune API for Netlify: /api/search and /api/suggest
// (offline downloads are not available on Netlify)
//
// Why this rewrite: the old version used `youtube-sr`, which crashed with
// "Cannot read properties of undefined (reading 'browseId')" whenever YouTube
// returned a result shape the library did not expect. This version talks to
// YouTube directly and reads every field defensively, so one odd result can
// never break the whole search.

const PAGE = 20, MAX = 5;

const json = (code, body) => ({
    statusCode: code,
    headers: {
        'Content-Type': 'application/json',
        // only cache good answers - never let a CDN keep an error
        'Cache-Control': code === 200 ? 'public, max-age=300' : 'no-store'
    },
    body: JSON.stringify(body)
});

const YT_URL = 'https://www.youtube.com/youtubei/v1/search?prettyPrint=false';
const CONTEXT = { client: { clientName: 'WEB', clientVersion: '2.20250310.01.00', hl: 'en', gl: 'IN' } };
const HEADERS = {
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://www.youtube.com',
    // skips the EU/consent interstitial that can block server requests
    'Cookie': 'CONSENT=YES+1; SOCS=CAI'
};

async function yt(body) {
    const r = await fetch(YT_URL, { method: 'POST', headers: HEADERS, body: JSON.stringify({ context: CONTEXT, ...body }) });
    if (!r.ok) throw new Error('YouTube HTTP ' + r.status);
    return r.json();
}

// Walk the whole response and collect video renderers + the next-page token.
// This keeps working even if YouTube moves things around in the tree.
function collect(node, out) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => collect(n, out)); return; }
    if (node.videoRenderer) out.videos.push(node.videoRenderer);
    if (node.lockupViewModel && node.lockupViewModel.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') out.lockups.push(node.lockupViewModel);
    const tok = node.continuationItemRenderer && node.continuationItemRenderer.continuationEndpoint &&
        node.continuationItemRenderer.continuationEndpoint.continuationCommand &&
        node.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
    if (tok) out.token = tok;
    for (const k in node) if (k !== 'videoRenderer' && k !== 'lockupViewModel') collect(node[k], out);
}

const txt = (o) => (o && (o.simpleText || (Array.isArray(o.runs) && o.runs.map(x => x.text).join('')))) || '';

function fromVideoRenderer(v) {
    const id = v && v.videoId;
    const duration = txt(v && v.lengthText);
    if (!id || !duration) return null;                       // skip live streams / broken items
    const owner = (v.ownerText || v.longBylineText || v.shortBylineText);
    return {
        id,
        title: txt(v.title) || 'Untitled',
        artist: (txt(owner) || 'YouTube').replace(/ - Topic$/, ''),
        duration,
        views: parseInt(String(txt(v.viewCountText)).replace(/[^\d]/g, ''), 10) || 0,
        thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`
    };
}

function fromLockup(l) {
    const id = l && l.contentId;
    if (!id) return null;
    let title = 'Untitled', artist = 'YouTube', duration = '';
    try { title = l.metadata.lockupMetadataViewModel.title.content || title; } catch (e) {}
    try {
        const rows = l.metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows;
        artist = rows[0].metadataParts[0].text.content || artist;
    } catch (e) {}
    try {
        const ov = l.contentImage.thumbnailViewModel.overlays || [];
        for (const o of ov) {
            const b = o.thumbnailBottomOverlayViewModel && o.thumbnailBottomOverlayViewModel.badges;
            if (b && b[0] && b[0].thumbnailBadgeViewModel) duration = b[0].thumbnailBadgeViewModel.text || duration;
        }
    } catch (e) {}
    if (!duration) return null;
    return { id, title, artist, duration, views: 0, thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` };
}

async function searchYouTube(q, need) {
    const items = [], seen = new Set();
    let data = await yt({ query: q, params: 'EgIQAQ%3D%3D' });          // filter: videos only
    for (let round = 0; round < 6; round++) {
        const out = { videos: [], lockups: [], token: null };
        collect(data, out);
        for (const v of out.videos) { const i = fromVideoRenderer(v); if (i && !seen.has(i.id)) { seen.add(i.id); items.push(i); } }
        for (const l of out.lockups) { const i = fromLockup(l); if (i && !seen.has(i.id)) { seen.add(i.id); items.push(i); } }
        if (items.length >= need || !out.token) break;
        data = await yt({ continuation: out.token });
    }
    return items;
}

// Backup: the old library, only used if the direct call fails.
async function searchFallback(q, need) {
    let YouTube;
    try { YouTube = require('youtube-sr').default; } catch (e) { throw new Error('fallback not installed'); }
    const res = await YouTube.search(q, { limit: need, type: 'video' });
    const seen = new Set();
    return (Array.isArray(res) ? res : res.videos || []).map(v => {
        try {
            return { id: v.id, title: v.title, artist: (v.channel && v.channel.name) || 'YouTube', duration: v.durationFormatted || '', views: Number(v.views) || 0, thumb: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg` };
        } catch (e) { return null; }
    }).filter(i => i && i.id && !seen.has(i.id) && seen.add(i.id));
}

exports.handler = async (event) => {
    const route = (event.rawUrl || event.path || '').split('?')[0].split('/').pop();
    const p = event.queryStringParameters || {};
    try {
        if (route === 'search') {
            const q = (p.q || '').trim();
            const page = Math.min(Math.max(parseInt(p.page, 10) || 1, 1), MAX);
            if (!q) return json(200, { items: [], hasMore: false });
            const need = page * PAGE;
            let all;
            try { all = await searchYouTube(q, need); }
            catch (e1) {
                console.error('direct search failed:', e1.message);
                all = await searchFallback(q, need);
            }
            return json(200, { items: all.slice((page - 1) * PAGE, need), hasMore: page < MAX && all.length >= need });
        }
        if (route === 'suggest') {
            const q = (p.q || '').trim();
            if (!q) return json(200, []);
            const r = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&oe=utf-8&q=${encodeURIComponent(q)}`);
            const d = await r.json();
            return json(200, Array.isArray(d[1]) ? d[1].slice(0, 8) : []);
        }
        return json(501, { error: 'Offline downloads need your own server (node server.js)' });
    } catch (e) {
        console.error('api error:', e);
        return json(500, { error: e.message });
    }
};