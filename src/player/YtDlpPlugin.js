'use strict';

const { ExtractorPlugin, Playlist, Song, DisTubeError } = require('distube');
const ytdlp = require('./ytdlp');
const config = require('../config/config');

const SPOTIFY_RE = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|artist)\//i;

function thumbnailOf(info) {
    if (info.thumbnail) return info.thumbnail;
    const thumbs = info.thumbnails;
    if (Array.isArray(thumbs) && thumbs.length) return thumbs[thumbs.length - 1].url;
    if (info.ie_key === 'Youtube' && info.id) return `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`;
    return undefined;
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
    }

    validate(url) {
        return /^https?:\/\//i.test(url);
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

    async resolve(url, options) {
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

    /** Search YouTube and return raw yt-dlp entries (fast: no stream extraction). */
    async search(query, limit = 5) {
        const info = await ytdlp.getJson(`ytsearch${limit}:${query}`, ['--flat-playlist']);
        return (info.entries || []).filter(Boolean);
    }

    getStreamURL(song) {
        if (!song.url) throw new DisTubeError('YTDLP_ERROR', 'This song has no URL.');
        return this.streamServer.urlFor(song.url);
    }

    getRelatedSongs() {
        return [];
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

module.exports = YtDlpPlugin;
