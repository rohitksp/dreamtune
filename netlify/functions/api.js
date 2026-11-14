// DreamTune API for Netlify: /api/search, /api/suggest and /api/stream
// /api/stream hands the app a song in chunks (<= 3 MB each, Netlify's response limit is 6 MB)
// so the app can keep the whole song, play it with the screen off and use it offline.
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

// songs only (for shelves, radio, up-next): no jukeboxes / non-stop mixes / hour-long compilations
const LONG_RE = /jukebox|non[\s-]?stop|nonstop|playlist|full album|back to back|\b\d+\s*(hours?|hrs?)\b|\b\d{2,3}\s*songs\b|top\s*\d{2,}/i;
const secs = (d) => String(d || '').split(':').reduce((a, b) => a * 60 + (Number(b) || 0), 0);
const isSong = (i) => { const s = secs(i.duration); return s >= 45 && s <= 540 && !LONG_RE.test(i.title || ''); };

async function searchYouTube(q, need, short) {
    const items = [], seen = new Set();
    let data = await yt({ query: q, params: 'EgIQAQ%3D%3D' });          // filter: videos only
    for (let round = 0; round < (short ? 8 : 6); round++) {
        const out = { videos: [], lockups: [], token: null };
        collect(data, out);
        for (const v of out.videos) { const i = fromVideoRenderer(v); if (i && !seen.has(i.id) && (!short || isSong(i))) { seen.add(i.id); items.push(i); } }
        for (const l of out.lockups) { const i = fromLockup(l); if (i && !seen.has(i.id) && (!short || isSong(i))) { seen.add(i.id); items.push(i); } }
        if (items.length >= need || !out.token) break;
        data = await yt({ continuation: out.token });
    }
    return items;
}

// Backup: the old library, only used if the direct call fails.
async function searchFallback(q, need, short) {
    let YouTube;
    try { YouTube = require('youtube-sr').default; } catch (e) { throw new Error('fallback not installed'); }
    const res = await YouTube.search(q, { limit: need, type: 'video' });
    const seen = new Set();
    return (Array.isArray(res) ? res : res.videos || []).map(v => {
        try {
            return { id: v.id, title: v.title, artist: (v.channel && v.channel.name) || 'YouTube', duration: v.durationFormatted || '', views: Number(v.views) || 0, thumb: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg` };
        } catch (e) { return null; }
    }).filter(i => i && i.id && (!short || isSong(i)) && !seen.has(i.id) && seen.add(i.id));
}


/* ---------------------------------------------------------------------
   /api/stream?id=VIDEOID&start=0&size=3145728
   Asks YouTube for a direct audio link (the way the phone apps do) and returns one
   byte range of the m4a audio. The app calls it again for the next range.
   NOTE: YouTube changes these app-client rules often and may refuse requests that come
   from data centres. If it does, this answers an error and the app falls back to the
   normal YouTube player automatically.
   --------------------------------------------------------------------- */
const PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const AUDIO_CLIENTS = [
    { cn: '28', cv: '1.65.10',
      ua: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
      ctx: { clientName: 'ANDROID_VR', clientVersion: '1.65.10', deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L', hl: 'en', gl: 'IN' } },
    { cn: '28', cv: '1.60.19',
      ua: 'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
      ctx: { clientName: 'ANDROID_VR', clientVersion: '1.60.19', deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L', hl: 'en', gl: 'IN' } },
    { cn: '5', cv: '20.10.4',
      ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
      ctx: { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82', hl: 'en', gl: 'IN' } }
];
const linkCache = new Map();           // videoId -> { url, total, ua, exp }  (kept while this function instance is warm)

async function findAudio(id) {
    const hit = linkCache.get(id);
    if (hit && hit.exp > Date.now()) return hit;
    let lastErr = 'no audio link';
    for (const c of AUDIO_CLIENTS) {
        try {
            const r = await fetch(PLAYER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'User-Agent': c.ua, 'X-YouTube-Client-Name': c.cn, 'X-YouTube-Client-Version': c.cv, 'Origin': 'https://www.youtube.com' },
                body: JSON.stringify({ videoId: id, contentCheckOk: true, racyCheckOk: true, context: { client: c.ctx } })
            });
            if (!r.ok) { lastErr = 'YouTube HTTP ' + r.status; continue; }
            const d = await r.json();
            const status = d.playabilityStatus && d.playabilityStatus.status;
            if (status && status !== 'OK') { lastErr = 'YouTube says: ' + status; continue; }
            const fmts = ((d.streamingData && d.streamingData.adaptiveFormats) || [])
                .filter(f => f.url && /^audio\/mp4/.test(f.mimeType || '') && Number(f.contentLength) > 0);
            if (!fmts.length) { lastErr = 'no direct audio link'; continue; }
            const lenSec = Number(d.videoDetails && d.videoDetails.lengthSeconds) || 0;
            // long songs (over 15 min) easily blow past the download size limit at full quality,
            // so for those take the smallest usable audio instead of the usual 128kbps pick
            const f = lenSec > 900
                ? (fmts.filter(x => (x.bitrate || 0) > 20000).sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0))[0] || fmts.sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0))[0])
                : (fmts.find(x => x.itag === 140) || fmts.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]);
            const rec = { url: f.url, total: Number(f.contentLength), ua: c.ua, exp: Date.now() + 12 * 60 * 1000 };
            linkCache.set(id, rec);
            return rec;
        } catch (e) { lastErr = e.message; }
    }
    throw new Error(lastErr);
}

async function streamChunk(id, start, size) {
    for (let attempt = 0; attempt < 2; attempt++) {
        const a = await findAudio(id);
        if (start >= a.total) return { total: a.total, buf: Buffer.alloc(0) };
        const end = Math.min(start + size, a.total) - 1;
        const r = await fetch(`${a.url}&range=${start}-${end}`, { headers: { 'User-Agent': a.ua, 'Range': `bytes=${start}-${end}` } });
        if (r.status === 200 || r.status === 206) {
            let buf = Buffer.from(await r.arrayBuffer());
            if (buf.length > end - start + 1) buf = buf.subarray(0, end - start + 1);      // server ignored the range: keep only what we asked for
            return { total: a.total, buf };
        }
        linkCache.delete(id);                                                               // link expired / refused: ask again once
        if (attempt === 1) throw new Error('audio server HTTP ' + r.status);
    }
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
            const short = p.short === '1';
            try { all = await searchYouTube(q, need, short); }
            catch (e1) {
                console.error('direct search failed:', e1.message);
                all = await searchFallback(q, need, short);
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
        if (route === 'stream') {
            const id = String(p.id || '');
            if (!/^[\w-]{11}$/.test(id)) return json(400, { error: 'bad id' });
            const start = Math.max(parseInt(p.start, 10) || 0, 0);
            const size = Math.min(Math.max(parseInt(p.size, 10) || 3145728, 65536), 3500000);
            const { total, buf } = await streamChunk(id, start, size);
            return {
                statusCode: 200, isBase64Encoded: true,
                headers: { 'Content-Type': 'audio/mp4', 'X-Total-Length': String(total), 'Access-Control-Expose-Headers': 'X-Total-Length', 'Cache-Control': 'private, max-age=3600' },
                body: buf.toString('base64')
            };
        }
        return json(501, { error: 'Unknown route' });
    } catch (e) {
        console.error('api error:', e);
        return json(500, { error: e.message });
    }
};
