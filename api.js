// DreamTune API for Netlify: /api/search and /api/suggest (offline downloads are not available here)
const YouTube = require('youtube-sr').default;
const PAGE = 20, MAX = 5;
const json = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
    const route = (event.rawUrl || event.path || '').split('?')[0].split('/').pop();
    const p = event.queryStringParameters || {};
    try {
        if (route === 'search') {
            const q = (p.q || '').trim();
            const page = Math.min(Math.max(parseInt(p.page, 10) || 1, 1), MAX);
            if (!q) return json(200, { items: [], hasMore: false });
            const need = page * PAGE;
            const res = await YouTube.search(q, { limit: need, type: 'video' });
            const seen = new Set();
            const all = (Array.isArray(res) ? res : res.videos || []).map(v => ({
                id: v.id, title: v.title, artist: (v.channel && v.channel.name) || 'YouTube',
                duration: v.durationFormatted || '', views: Number(v.views) || 0,
                thumb: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`
            })).filter(i => !seen.has(i.id) && seen.add(i.id));
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
    } catch (e) { return json(500, { error: e.message }); }
};
