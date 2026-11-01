'use strict';

/**
 * A tiny HTTP server bound to 127.0.0.1 only.
 *
 * DisTube hands ffmpeg a URL to read audio from. YouTube now refuses (403)
 * when ffmpeg fetches its media URLs directly, so instead we give ffmpeg a
 * local URL, and this server pipes yt-dlp's own download into the response.
 *
 * It also prefetches the next song in the queue into memory so there is
 * almost no silence between songs.
 */

const http = require('node:http');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const ytdlp = require('./ytdlp');
const config = require('../config/config');

const PREFETCH_MAX_BYTES = 64 * 1024 * 1024; // ~ 1 hour of opus audio
const PREFETCH_TTL_MS = 30 * 60 * 1000;
const YOUTUBE_BLOCK_MEMORY_MS = 10 * 60 * 1000;
const BLOCKED_RE = /confirm you.?re not a bot|Sign in to confirm|HTTP Error 403|Requested format is not available/i;

function isYouTube(url) {
    try {
        return /(^|\.)(youtube\.com|youtu\.be)$/i.test(new URL(url).hostname);
    } catch {
        return false;
    }
}

class StreamServer extends EventEmitter {
    constructor() {
        super();
        this.key = crypto.randomBytes(16).toString('hex');
        this.port = null;
        /** @type {Map<string, {proc, chunks: Buffer[], size: number, done: boolean, failed: boolean, listeners: Set<Function>, timer}>} */
        this.prefetches = new Map();
        /** song url -> search text used for the SoundCloud fallback */
        this.fallbackQueries = new Map();
        /** While YouTube is known to block this server, go straight to the fallback. */
        this.youtubeBlockedUntil = 0;
        this.server = http.createServer((req, res) => this.#handle(req, res));
    }

    start() {
        return new Promise((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(0, '127.0.0.1', () => {
                this.port = this.server.address().port;
                console.log(`[STREAM] Local audio relay listening on 127.0.0.1:${this.port}`);
                resolve();
            });
        });
    }

    /**
     * The URL that ffmpeg should read for a given song. Stable, so DisTube can reuse it.
     * `fallbackQuery` (song title) is used to find the song on SoundCloud if YouTube blocks it.
     */
    urlFor(songUrl, fallbackQuery) {
        let url = `http://127.0.0.1:${this.port}/audio?key=${this.key}&u=${encodeURIComponent(songUrl)}`;
        if (fallbackQuery) {
            url += `&q=${encodeURIComponent(fallbackQuery)}`;
            this.fallbackQueries.set(songUrl, fallbackQuery);
            if (this.fallbackQueries.size > 500) this.fallbackQueries.delete(this.fallbackQueries.keys().next().value);
        }
        return url;
    }

    /** Remember the fallback search text for a song (used by prefetch). */
    setFallbackQuery(songUrl, query) {
        if (!songUrl || !query) return;
        this.fallbackQueries.set(songUrl, query);
        if (this.fallbackQueries.size > 500) this.fallbackQueries.delete(this.fallbackQueries.keys().next().value);
    }

    #youtubeBlocked() {
        return Date.now() < this.youtubeBlockedUntil || ytdlp.youtubeStatus() === 'blocked';
    }

    #markBlocked() {
        this.youtubeBlockedUntil = Date.now() + YOUTUBE_BLOCK_MEMORY_MS;
    }

    /** What yt-dlp should download for this song right now. */
    #target(songUrl, query) {
        if (config.soundcloudFallback && query && isYouTube(songUrl) && this.#youtubeBlocked()) {
            return { target: `scsearch1:${query}`, isFallback: true };
        }
        return { target: songUrl, isFallback: false };
    }

    /** Start downloading a song in the background so it is ready when needed. */
    prefetch(songUrl) {
        if (!songUrl || this.prefetches.has(songUrl)) return;
        // Only keep one prefetch at a time.
        for (const url of this.prefetches.keys()) this.#dropPrefetch(url);

        const { target, isFallback } = this.#target(songUrl, this.fallbackQueries.get(songUrl));
        const proc = ytdlp.spawnAudio(target);
        const entry = { proc, isFallback, chunks: [], size: 0, done: false, failed: false, timer: null, onData: null };
        entry.timer = setTimeout(() => this.#dropPrefetch(songUrl), PREFETCH_TTL_MS);
        entry.timer.unref();
        this.prefetches.set(songUrl, entry);

        // Buffering in memory only happens before handoff, and is capped.
        entry.onData = chunk => {
            entry.chunks.push(chunk);
            entry.size += chunk.length;
            if (entry.size > PREFETCH_MAX_BYTES) this.#dropPrefetch(songUrl);
        };
        proc.stdout.on('data', entry.onData);
        let stderr = '';
        proc.stderr.on('data', d => { stderr += d; });
        proc.on('error', () => { entry.failed = true; });
        proc.on('close', code => {
            entry.done = true;
            if (code !== 0 && entry.size === 0) {
                entry.failed = true;
                if (!isFallback && isYouTube(songUrl) && BLOCKED_RE.test(stderr)) this.#markBlocked();
            }
        });
    }

    #dropPrefetch(songUrl) {
        const entry = this.prefetches.get(songUrl);
        if (!entry) return;
        this.prefetches.delete(songUrl);
        clearTimeout(entry.timer);
        entry.proc.stdout.off('data', entry.onData);
        entry.chunks = [];
        entry.failed = true;
        if (!entry.done) entry.proc.kill();
    }

    #handle(req, res) {
        let parsed;
        try {
            parsed = new URL(req.url, 'http://127.0.0.1');
        } catch {
            res.writeHead(400).end();
            return;
        }
        if (parsed.pathname !== '/audio' || parsed.searchParams.get('key') !== this.key) {
            res.writeHead(404).end();
            return;
        }
        const songUrl = parsed.searchParams.get('u');
        // eslint-disable-next-line no-control-regex
        const query = (parsed.searchParams.get('q') || '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200).trim();
        if (!songUrl || !/^https?:\/\//i.test(songUrl)) {
            res.writeHead(400).end();
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });

        const entry = this.prefetches.get(songUrl);
        this.prefetches.delete(songUrl);
        if (entry) clearTimeout(entry.timer);
        // Use the prefetch only if it is healthy and already delivering audio.
        if (entry && !entry.failed && entry.size > 0) {
            if (entry.isFallback) this.emit('fallback', songUrl);
            this.#serveFromPrefetch(entry, req, res);
            return;
        }
        if (entry && !entry.done) entry.proc.kill();
        this.#serveLive(songUrl, query, req, res);
    }

    /**
     * Pipe yt-dlp's download into the response. If YouTube refuses (bot check /
     * 403) before any audio was sent, retry the same song from SoundCloud.
     */
    #serveLive(songUrl, query, req, res) {
        let closed = false;
        let current = null;

        const run = (target, isFallback) => {
            const proc = ytdlp.spawnAudio(target);
            current = proc;
            let stderr = '';
            let bytes = 0;
            proc.stderr.on('data', d => { stderr += d; });
            proc.stdout.on('data', d => { bytes += d.length; });
            proc.stdout.pipe(res, { end: false });
            proc.on('error', err => {
                console.error('[STREAM] Could not start yt-dlp:', err.message);
                res.destroy();
            });
            proc.on('close', code => {
                if (closed) return; // the listener went away (skip/stop): nothing to report
                if (code !== 0 && bytes === 0) {
                    const blocked = !isFallback && isYouTube(songUrl) && BLOCKED_RE.test(stderr);
                    if (blocked) this.#markBlocked();
                    if (blocked && config.soundcloudFallback && query) {
                        console.warn(`[STREAM] YouTube blocked ${songUrl}; trying SoundCloud for "${query}"`);
                        this.emit('fallback', songUrl);
                        run(`scsearch1:${query}`, true);
                        return;
                    }
                    console.error(`[STREAM] yt-dlp exited with code ${code} for ${target}\n${stderr.trim().slice(-800)}`);
                    this.emit('streamError', songUrl, new Error(isFallback
                        ? `YouTube blocked this song and no SoundCloud version could be played. ${stderr.trim().slice(-300)}`
                        : stderr.trim() || `yt-dlp exited with code ${code}`));
                } else if (code !== 0) {
                    console.error(`[STREAM] yt-dlp exited with code ${code} after ${bytes} bytes for ${target}`);
                }
                res.end();
            });
        };

        const first = this.#target(songUrl, query);
        if (first.isFallback) this.emit('fallback', songUrl);
        run(first.target, first.isFallback);

        const cleanup = () => {
            closed = true;
            if (current && current.exitCode === null) current.kill();
        };
        req.on('close', cleanup);
        res.on('close', cleanup);
    }

    #serveFromPrefetch(entry, req, res) {
        const { proc } = entry;
        // Stop buffering into memory, send what was prefetched (at most PREFETCH_MAX_BYTES),
        // then pipe the rest so normal backpressure applies and memory stays bounded.
        proc.stdout.pause();
        proc.stdout.off('data', entry.onData);
        const buffered = entry.chunks;
        entry.chunks = [];
        for (const chunk of buffered) res.write(chunk);

        if (entry.done || proc.stdout.readableEnded) {
            res.end();
        } else {
            proc.stdout.pipe(res);
        }
        const cleanup = () => { if (proc.exitCode === null) proc.kill(); };
        req.on('close', cleanup);
        res.on('close', cleanup);
    }

    stop() {
        for (const url of [...this.prefetches.keys()]) this.#dropPrefetch(url);
        this.server.close();
    }
}

module.exports = StreamServer;
