'use strict';

/**
 * Lightweight YouTube lookups straight from Node (YouTube's own "InnerTube" web API).
 *
 * Searching and reading a video's title/length with yt-dlp means starting a
 * Python program, which costs seconds of CPU. On a small server (Render's free
 * plan has 0.1 CPU) that turned into minutes. These HTTP calls use ~0.1 s of CPU.
 * yt-dlp is still used to download the audio itself, and as a fallback here.
 */

const CLIENT = { clientName: 'WEB', clientVersion: '2.20251030.01.00', hl: 'en', gl: 'US' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const VIDEOS_ONLY = 'EgIQAQ%3D%3D'; // search filter: type = video

async function innertube(endpoint, body) {
    const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?prettyPrint=false`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'user-agent': UA,
            'x-youtube-client-name': '1',
            'x-youtube-client-version': CLIENT.clientVersion,
        },
        body: JSON.stringify({ context: { client: CLIENT }, ...body }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`YouTube API ${endpoint} returned HTTP ${res.status}`);
    return res.json();
}

/** Yield every value stored under `key` anywhere in a nested object. */
function* findAll(node, key) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (const item of node) yield* findAll(item, key);
        return;
    }
    for (const [k, v] of Object.entries(node)) {
        if (k === key) yield v;
        else yield* findAll(v, key);
    }
}

function parseLength(text) {
    if (!text) return 0;
    return String(text).split(':').reduce((total, part) => total * 60 + (Number(part) || 0), 0);
}

const text = t => t?.simpleText ?? t?.runs?.map(r => r.text).join('') ?? '';
const bestThumb = thumbs => (Array.isArray(thumbs) && thumbs.length ? thumbs[thumbs.length - 1].url : undefined);

/**
 * Search YouTube. Returns entries shaped like yt-dlp's flat results, so the rest
 * of the code can treat both the same way.
 */
async function search(query, limit = 5) {
    const data = await innertube('search', { query, params: VIDEOS_ONLY });
    const results = [];
    for (const v of findAll(data, 'videoRenderer')) {
        if (!v?.videoId) continue;
        const live = Boolean(v.badges?.some(b => /LIVE/.test(b.metadataBadgeRenderer?.style || '')))
            || !v.lengthText;
        results.push({
            id: v.videoId,
            ie_key: 'Youtube',
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
            webpage_url: `https://www.youtube.com/watch?v=${v.videoId}`,
            title: text(v.title),
            duration: live ? null : parseLength(text(v.lengthText)),
            channel: text(v.ownerText) || undefined,
            uploader: text(v.ownerText) || undefined,
            thumbnails: v.thumbnail?.thumbnails,
            live_status: live ? 'is_live' : 'not_live',
        });
        if (results.length >= limit) break;
    }
    return results;
}

/** Title, length, channel and thumbnail of one video (works even when playback is blocked). */
async function video(id) {
    const data = await innertube('player', { videoId: id });
    const d = data.videoDetails;
    if (!d?.videoId) {
        const reason = data.playabilityStatus?.reason || data.playabilityStatus?.status || 'unknown';
        throw new Error(`Video unavailable (${reason})`);
    }
    const live = Boolean(d.isLive || (d.isLiveContent && Number(d.lengthSeconds) === 0));
    return {
        id: d.videoId,
        ie_key: 'Youtube',
        url: `https://www.youtube.com/watch?v=${d.videoId}`,
        webpage_url: `https://www.youtube.com/watch?v=${d.videoId}`,
        title: d.title,
        duration: live ? null : Number(d.lengthSeconds) || 0,
        channel: d.author,
        uploader: d.author,
        thumbnail: bestThumb(d.thumbnail?.thumbnails),
        live_status: live ? 'is_live' : 'not_live',
        age_limit: data.playabilityStatus?.status === 'LOGIN_REQUIRED' && /age/i.test(data.playabilityStatus?.reason || '') ? 18 : 0,
    };
}

module.exports = { search, video };
