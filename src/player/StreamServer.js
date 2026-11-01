'use strict';

/**
 * A tiny HTTP server bound to 127.0.0.1 only.
 *
 * DisTube hands ffmpeg a URL to read audio from. YouTube now refuses (403)
 * when ffmpeg fetches its media URLs directly, so instead we give ffmpeg a
 * local URL, and this server pipes yt-dlp's own download into the response.
 *
 * - The next song in the queue is downloaded in the background (at low CPU
 *   priority) while the current one plays, so the next song starts at once.
 *   If that download is still starting when it's needed, we wait for it rather
 *   than starting over (on a slow server, starting over costs minutes).
 * - If YouTube refuses a song, the same song is played from SoundCloud.
 * - If no audio arrives within STREAM_START_TIMEOUT, we give up loudly instead
 *   of leaving the bot sitting silently in the channel.
 */

const http = require('node:http');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const ytdlp = require('./ytdlp');
const config = require('../config/config');

const PREFETCH_MAX_BYTES = 64 * 1024 * 1024; // ~ 1 hour of opus audio
const PREFETCH_TTL_MS = 30 * 60 * 1000;
const BLOCKED_RE = /confirm you.?re not a bot|Sign in to confirm|HTTP Error 403|Requested format is not available/i;

function isYouTube(url) {
    try {
        return /(^|\.)(youtube\.com|youtu\.be)$/i.test(new URL(url).hostname);
    } catch {
        return false;
    }
}

/**
 * One running yt-dlp download. Audio is kept in memory until a listener
 * (ffmpeg) attaches; after that it is forwarded with backpressure.
 */
class Job extends EventEmitter {
    constructor(target, isFallback, background) {
        super();
        this.target = target;
        this.isFallback = isFallback;
        this.startedAt = Date.now();
        this.chunks = [];
        this.buffered = 0;
        this.size = 0;
        this.stderr = '';
        this.done = false;
        this.code = null;
        this.timedOut = false;
        this.res = null;
        this.proc = ytdlp.spawnAudio(target, { background });

        this.proc.stdout.on('data', chunk => {
            this.size += chunk.length;
            if (this.res) {
                if (!this.res.write(chunk) && !this.waitingForDrain) {
                    this.waitingForDrain = true;
                    this.proc.stdout.pause();
                    this.res.once('drain', () => {
                        this.waitingForDrain = false;
                        this.proc.stdout.resume();
                    });
                }
            } else {
                this.chunks.push(chunk);
                this.buffered += chunk.length;
                if (this.buffered > PREFETCH_MAX_BYTES) this.kill();
            }
            this.emit('data');
        });
        this.proc.stderr.on('data', d => { this.stderr = (this.stderr + d).slice(-4000); });
        this.proc.on('error', err => { this.stderr += `\n${err.message}`; });
        this.proc.on('close', code => {
            this.done = true;
            this.code = code;
            this.emit('close', code);
        });
    }

    /** Failed without producing any audio. */
    get failed() {
        return this.done && this.size === 0;
    }

    attach(res) {
        this.res = res;
        for (const chunk of this.chunks) res.write(chunk);
        this.chunks = [];
        this.buffered = 0;
    }

    kill() {
        if (!this.done) this.proc.kill();
    }
}

class StreamServer extends EventEmitter {
    constructor() {
        super();
        this.key = crypto.randomBytes(16).toString('hex');
        this.port = null;
        /** song url -> { job, timer } */
        this.prefetches = new Map();
        /** song url -> search text used for the SoundCloud fallback */
        this.fallbackQueries = new Map();
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
            this.setFallbackQuery(songUrl, fallbackQuery);
        }
        return url;
    }

    /** Remember the fallback search text for a song (used by prefetch). */
    setFallbackQuery(songUrl, query) {
        if (!songUrl || !query) return;
        this.fallbackQueries.set(songUrl, query);
        if (this.fallbackQueries.size > 500) this.fallbackQueries.delete(this.fallbackQueries.keys().next().value);
    }

    /** What yt-dlp should download for this song right now. */
    #target(songUrl, query) {
        if (config.soundcloudFallback && query && isYouTube(songUrl) && ytdlp.isYouTubeBlocked()) {
            return { target: `scsearch1:${query}`, isFallback: true };
        }
        return { target: songUrl, isFallback: false };
    }

    /** Start downloading a song in the background so it is ready when needed. */
    prefetch(songUrl) {
        if (!songUrl || this.prefetches.has(songUrl)) return;
        // Only one background download at a time: the CPU is precious.
        for (const url of [...this.prefetches.keys()]) this.#dropPrefetch(url);

        const { target, isFallback } = this.#target(songUrl, this.fallbackQueries.get(songUrl));
        const job = new Job(target, isFallback, true);
        const timer = setTimeout(() => this.#dropPrefetch(songUrl), PREFETCH_TTL_MS);
        timer.unref();
        this.prefetches.set(songUrl, { job, timer });
        job.once('close', () => {
            if (job.failed && !isFallback && isYouTube(songUrl) && BLOCKED_RE.test(job.stderr)) ytdlp.markYouTubeBlocked();
        });
    }

    #dropPrefetch(songUrl) {
        const entry = this.prefetches.get(songUrl);
        if (!entry) return;
        this.prefetches.delete(songUrl);
        clearTimeout(entry.timer);
        entry.job.kill();
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

        // ffmpeg disconnects on skip/stop; late writes must not crash the bot.
        res.on('error', () => {});
        req.on('error', () => {});
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });

        // Take over the background download if there is a usable one (even if it is still starting).
        let job = null;
        const entry = this.prefetches.get(songUrl);
        if (entry) {
            this.prefetches.delete(songUrl);
            clearTimeout(entry.timer);
            if (entry.job.failed) entry.job.kill();
            else job = entry.job;
        }
        this.#serve(songUrl, query, job, req, res);
    }

    /**
     * Feed one song to ffmpeg. If YouTube refuses (bot check / 403) or nothing
     * arrives in time before any audio was sent, retry the same song from SoundCloud.
     */
    #serve(songUrl, query, prefetched, req, res) {
        let closed = false;
        let current = null;
        let watchdog = null;
        const timeoutMs = config.streamStartTimeout * 1000;

        const start = job => {
            current = job;
            if (job.isFallback) this.emit('fallback', songUrl);
            job.attach(res);
            const onAudio = () => {
                clearTimeout(watchdog);
                if (!job.isFallback && isYouTube(songUrl)) ytdlp.markYouTubeOk();
                this.emit('started', songUrl);
            };
            if (job.size > 0) setImmediate(onAudio); // prefetched audio is already here
            else job.once('data', onAudio);
            if (job.size === 0 && !job.done && timeoutMs > 0) {
                watchdog = setTimeout(() => {
                    if (current === job && job.size === 0 && !job.done) {
                        console.warn(`[STREAM] No audio after ${config.streamStartTimeout}s for ${job.target}; giving up on it.`);
                        job.timedOut = true;
                        job.kill();
                    }
                }, timeoutMs);
            }
            const onClose = code => {
                clearTimeout(watchdog);
                if (closed || current !== job) return; // listener left (skip/stop) or replaced
                if (job.size > 0) {
                    if (code !== 0) console.error(`[STREAM] yt-dlp exited with code ${code} after ${job.size} bytes for ${job.target}`);
                    res.end();
                    return;
                }
                const youtubeRefused = !job.isFallback && isYouTube(songUrl);
                const blocked = youtubeRefused && BLOCKED_RE.test(job.stderr);
                if (blocked) ytdlp.markYouTubeBlocked();
                if (youtubeRefused && (blocked || job.timedOut) && config.soundcloudFallback && query) {
                    console.warn(`[STREAM] YouTube ${blocked ? 'blocked' : 'timed out on'} ${songUrl}; trying SoundCloud for "${query}"`);
                    start(new Job(`scsearch1:${query}`, true, false));
                    return;
                }
                const reason = job.timedOut
                    ? `No audio arrived within ${config.streamStartTimeout} seconds (the server may be overloaded).`
                    : job.isFallback
                        ? `YouTube blocked this song and no SoundCloud version could be played. ${job.stderr.trim().slice(-300)}`
                        : job.stderr.trim() || `yt-dlp exited with code ${code}`;
                console.error(`[STREAM] Failed: ${job.target}\n${reason.slice(-800)}`);
                this.emit('streamError', songUrl, new Error(reason));
                res.end();
            };
            if (job.done) onClose(job.code);
            else job.once('close', onClose);
        };

        if (prefetched) {
            start(prefetched);
        } else {
            const { target, isFallback } = this.#target(songUrl, query);
            start(new Job(target, isFallback, false));
        }

        const cleanup = () => {
            closed = true;
            clearTimeout(watchdog);
            current?.kill();
        };
        req.on('close', cleanup);
        res.on('close', cleanup);
    }

    stop() {
        for (const url of [...this.prefetches.keys()]) this.#dropPrefetch(url);
        this.server.close();
    }
}

module.exports = StreamServer;
