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

const PREFETCH_MAX_BYTES = 64 * 1024 * 1024; // ~ 1 hour of opus audio
const PREFETCH_TTL_MS = 30 * 60 * 1000;

class StreamServer extends EventEmitter {
    constructor() {
        super();
        this.key = crypto.randomBytes(16).toString('hex');
        this.port = null;
        /** @type {Map<string, {proc, chunks: Buffer[], size: number, done: boolean, failed: boolean, listeners: Set<Function>, timer}>} */
        this.prefetches = new Map();
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

    /** The URL that ffmpeg should read for a given song page URL. Stable, so DisTube can reuse it. */
    urlFor(songUrl) {
        return `http://127.0.0.1:${this.port}/audio?key=${this.key}&u=${encodeURIComponent(songUrl)}`;
    }

    /** Start downloading a song in the background so it is ready when needed. */
    prefetch(songUrl) {
        if (!songUrl || this.prefetches.has(songUrl)) return;
        // Only keep one prefetch at a time.
        for (const url of this.prefetches.keys()) this.#dropPrefetch(url);

        const proc = ytdlp.spawnAudio(songUrl);
        const entry = { proc, chunks: [], size: 0, done: false, failed: false, timer: null, onData: null };
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
        proc.stderr.on('data', () => {});
        proc.on('error', () => { entry.failed = true; });
        proc.on('close', code => {
            entry.done = true;
            if (code !== 0 && entry.size === 0) entry.failed = true;
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
        if (!songUrl || !/^https?:\/\//i.test(songUrl)) {
            res.writeHead(400).end();
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });

        const entry = this.prefetches.get(songUrl);
        if (entry && !entry.failed) {
            this.prefetches.delete(songUrl);
            clearTimeout(entry.timer);
            this.#serveFromPrefetch(entry, req, res);
            return;
        }
        this.#serveLive(songUrl, req, res);
    }

    #serveLive(songUrl, req, res) {
        const proc = ytdlp.spawnAudio(songUrl);
        let stderr = '';
        let bytes = 0;
        proc.stderr.on('data', d => { stderr += d; });
        proc.stdout.on('data', d => { bytes += d.length; });
        proc.stdout.pipe(res);
        proc.on('error', err => {
            console.error('[STREAM] Could not start yt-dlp:', err.message);
            res.destroy();
        });
        proc.on('close', code => {
            if (code !== 0 && code !== null) {
                console.error(`[STREAM] yt-dlp exited with code ${code} for ${songUrl}\n${stderr.trim().slice(-800)}`);
                // A process killed on skip has code null; only report real failures that produced no audio.
                if (bytes === 0) this.emit('streamError', songUrl, new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
            }
        });
        const cleanup = () => { if (proc.exitCode === null) proc.kill(); };
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
