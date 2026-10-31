'use strict';

const { ExtractorPlugin, Playlist, Song, DisTubeError } = require('distube');
const ytdlp = require('./ytdlp');
const config = require('../config/config');

const SPOTIFY_RE = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|artist)\//i;

/**
 * Only links to these music sites are accepted. yt-dlp would otherwise fetch any
 * URL a Discord user types (including internal/cloud-metadata addresses) from the
 * server - a server-side request forgery risk. Subdomains are allowed.
 */
const ALLOWED_HOSTS = [
    'youtube.com', 'youtu.be', 'youtube-nocookie.com',
    'soundcloud.com',
    'bandcamp.com',
    'open.spotify.com',
    'vimeo.com',
    'twitch.tv',
    'mixcloud.com',
    'audiomack.com',
    'deezer.com',
    'dailymotion.com',
    ...(process.env.EXTRA_ALLOWED_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean),
];

/**
 * Returns the normalized URL if it points to an allowed site, otherwise null.
 * Callers must pass the returned string (not the raw input) on to yt-dlp, so
 * the URL that was checked is exactly the URL that gets fetched. Characters
 * that different URL parsers disagree on (backslashes, whitespace, control
 * characters) are rejected outright.
 */
function normalizeAllowedUrl(input) {
    if (typeof input !== 'string' || input.length > 2048) return null;
    // eslint-disable-next-line no-control-regex
    if (/[\\\s\u0000-\u001f\u007f]/.test(input)) return null;
    let url;
    try {
        url = new URL(input);
    } catch {
        return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password || (url.port && url.port !== '80' && url.port !== '443')) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!/^[a-z0-9.-]+$/.test(host)) return null; // no IP-literal tricks, IDN or percent-encoding
    if (!ALLOWED_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`))) return null;
    return url.href;
}

function isAllowedUrl(input) {
    return normalizeAllowedUrl(input) !== null;
}

function thumbnailOf(info) {
    if (info.thumbnail) return info.thumbnail;
    const thumbs = info.thumbnails;
    if (Array.isArray(thumbs) && thumbs.length) return thumbs[thumbs.length - 1].url;
    if (info.ie_key === 'Youtube' && info.id) return `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`;
    return undefined;
}

function normTitle(title) {
    return String(title || '').toLowerCase()
        .replace(/\(.*?\)|\[.*?\]/g, ' ')
        .replace(/official|video|audio|lyrics?|hd|4k|remaster(ed)?/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function youtubeIdOf(url) {
    if (!url) return null;
    try {
        const u = new URL(url);
        const host = u.hostname.replace(/^(www|m|music)\./, '');
        if (host === 'youtu.be') return u.pathname.slice(1, 12) || null;
        if (host === 'youtube.com') {
            const v = u.searchParams.get('v') || /^\/(?:shorts|live|embed)\/([\w-]{11})/.exec(u.pathname)?.[1];
            return v && /^[\w-]{11}$/.test(v) ? v : null;
        }
    } catch {
        // not a URL
    }
    return null;
}

function pageUrlOf(info) {
    if (info.webpage_url) return info.webpage_url;
    if (info.ie_key === 'Youtube' && info.id) return `https://www.youtube.com/watch?v=${info.id}`;
    return info.url || info.original_url;
}

/**
 * DisTube plugin that resolves, searches and plays everything through yt-dlp.
 * Works with YouTube, YouTube Music, SoundCloud, Bandcamp and ~1800 other sites.
 */
class YtDlpPlugin extends ExtractorPlugin {
    /** @param {import('./StreamServer')} streamServer */
    constructor(streamServer) {
        super();
        this.streamServer = streamServer;
        /** song url -> { at, songs } */
        this.relatedCache = new Map();
    }

    validate(url) {
        return isAllowedUrl(url);
    }

    toSong(info, options) {
        return new Song({
            plugin: this,
            source: (info.extractor_key || info.ie_key || info.extractor || 'web').toLowerCase(),
            playFromSource: true,
            id: String(info.id ?? pageUrlOf(info)),
            name: info.title || info.fulltitle || 'Unknown title',
            url: pageUrlOf(info),
            isLive: Boolean(info.is_live || info.live_status === 'is_live'),
            thumbnail: thumbnailOf(info),
            duration: info.is_live ? 0 : Number(info.duration) || 0,
            uploader: {
                name: info.uploader || info.channel || undefined,
                url: info.uploader_url || info.channel_url || undefined,
            },
            views: info.view_count,
            likes: info.like_count,
            ageRestricted: Boolean(info.age_limit) && info.age_limit >= 18,
        }, options);
    }

    async resolve(rawUrl, options) {
        const url = normalizeAllowedUrl(rawUrl);
        if (!url) throw new DisTubeError('YTDLP_ERROR', 'Links from that website are not allowed.');
        const spotify = SPOTIFY_RE.exec(url);
        if (spotify) return this.#resolveSpotify(url, spotify[1].toLowerCase(), options);

        let info;
        try {
            info = await ytdlp.getJson(url, [
                '--flat-playlist',
                '--no-playlist', // a watch?v=..&list=.. link plays just that video
                '--playlist-items', `1:${config.maxPlaylistSize}`,
            ]);
        } catch (err) {
            throw new DisTubeError('YTDLP_ERROR', err.message);
        }

        if (Array.isArray(info.entries)) {
            const songs = info.entries
                .filter(e => e && (e.url || e.webpage_url || e.id))
                .filter(e => !/\[(private|deleted) video\]/i.test(e.title || ''))
                .map(e => this.toSong(e, options));
            if (!songs.length) throw new DisTubeError('YTDLP_ERROR', 'That playlist is empty or private.');
            return new Playlist({
                source: (info.extractor_key || 'web').toLowerCase(),
                songs,
                id: String(info.id ?? url),
                name: info.title || 'Playlist',
                url: info.webpage_url || url,
                thumbnail: thumbnailOf(info) || songs[0].thumbnail,
            }, options);
        }
        return this.toSong(info, options);
    }

    async searchSong(query, options) {
        const results = await this.search(query, 1);
        return results.length ? this.toSong(results[0], options) : null;
    }

    /**
     * Best normal song for free text such as "90s rock" or "lofi chill": skips live
     * streams and multi-hour compilations, which make bad radio starting points.
     */
    async findSong(query) {
        const results = await this.search(query, 8);
        const isSong = e => e && e.live_status !== 'is_live' && Number(e.duration) >= 60 && Number(e.duration) <= 15 * 60;
        return results.find(isSong) || results.find(e => e && e.live_status !== 'is_live') || results[0] || null;
    }

    /** Search YouTube and return raw yt-dlp entries (fast: no stream extraction). */
    async search(query, limit = 5) {
        const info = await ytdlp.getJson(`ytsearch${limit}:${query}`, ['--flat-playlist']);
        return (info.entries || []).filter(Boolean);
    }

    getStreamURL(song) {
        if (!song.url) throw new DisTubeError('YTDLP_ERROR', 'This song has no URL.');
        return this.streamServer.urlFor(song.url);
    }

    /**
     * Songs related to `song`, used by autoplay and /radio.
     * YouTube songs use YouTube's own "Mix" for that video (the same list YouTube
     * shows as "Mix - <song>"); other sites fall back to a YouTube search by title.
     * @param {Song} song
     * @param {number} [limit]
     */
    async getRelatedSongs(song, limit = 25) {
        const cacheKey = `${song.url}|${limit}`;
        const cached = this.relatedCache.get(cacheKey);
        if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.songs.map(s => this.#cloneSong(s));

        let entries = [];
        let id = youtubeIdOf(song.url);
        try {
            if (!id && song.name) {
                // Not a YouTube song (e.g. SoundCloud): find it on YouTube, then use that video's Mix.
                const match = await this.findSong([song.name, song.uploader?.name].filter(Boolean).join(' '));
                id = match?.id && /^[\w-]{11}$/.test(match.id) ? match.id : null;
            }
            if (id) {
                const mix = await ytdlp.getJson(`https://www.youtube.com/watch?v=${id}&list=RD${id}`,
                    ['--flat-playlist', '--yes-playlist', '--playlist-items', `1:${limit + 1}`]);
                entries = (mix.entries || []).filter(e => e && e.id && e.id !== id);
            }
            if (!entries.length && song.name) {
                const query = [song.uploader?.name, 'similar songs'].filter(Boolean).join(' ');
                entries = await this.search(query, Math.min(limit + 1, 10));
            }
            // Never "relate" a song to itself or to re-uploads with the same title.
            const own = normTitle(song.name);
            entries = entries.filter(e => e && e.id !== id && pageUrlOf(e) !== song.url
                && !(own.length >= 4 && normTitle(e.title).includes(own)));
        } catch (err) {
            console.error('[RELATED] Could not get related songs:', err.message.split('\n')[0]);
            return [];
        }

        const songs = entries
            .filter(e => !e.live_status || e.live_status === 'not_live' || e.live_status === 'was_live')
            .filter(e => !(Number(e.duration) > 15 * 60)) // skip hour-long mixes/compilations
            .slice(0, limit)
            .map(e => this.toSong(e, {}));
        this.relatedCache.set(cacheKey, { at: Date.now(), songs });
        if (this.relatedCache.size > 100) this.relatedCache.delete(this.relatedCache.keys().next().value);
        return songs.map(s => this.#cloneSong(s));
    }

    #cloneSong(s) {
        // DisTube mutates songs (member, metadata, stream), so hand out fresh copies.
        return new Song({
            plugin: this, source: s.source, playFromSource: true, id: s.id, name: s.name, url: s.url,
            isLive: s.isLive, thumbnail: s.thumbnail, duration: s.duration, uploader: s.uploader,
        }, {});
    }

    async #resolveSpotify(url, kind, options) {
        if (kind !== 'track') {
            throw new DisTubeError('YTDLP_ERROR',
                'Only single Spotify **track** links are supported. For playlists, paste a YouTube or SoundCloud playlist link instead.');
        }
        // Spotify audio is DRM-protected, so look the track up on YouTube by title + artist.
        let title;
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0)' },
                signal: AbortSignal.timeout(15_000),
            });
            const html = await res.text();
            const meta = name => new RegExp(`<meta[^>]+(?:property|name)="${name}"[^>]+content="([^"]*)"`, 'i').exec(html)?.[1];
            const songTitle = meta('og:title');
            const description = meta('og:description') || '';
            // og:description looks like "Artist · Album · Song · 2020"
            const artist = description.split(' · ')[0];
            title = [songTitle, artist].filter(Boolean).join(' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
        } catch {
            // fall through
        }
        if (!title) throw new DisTubeError('YTDLP_ERROR', 'Could not read that Spotify link.');
        const song = await this.searchSong(`${title} audio`, options);
        if (!song) throw new DisTubeError('NO_RESULT', title);
        return song;
    }
}

YtDlpPlugin.isAllowedUrl = isAllowedUrl;
YtDlpPlugin.normalizeAllowedUrl = normalizeAllowedUrl;
YtDlpPlugin.ALLOWED_HOSTS = ALLOWED_HOSTS;
module.exports = YtDlpPlugin;
