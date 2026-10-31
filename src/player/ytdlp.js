'use strict';

/**
 * Thin wrapper around the yt-dlp binary.
 *
 * - Downloads the right standalone build for this OS into ./bin on first run
 *   (no Python needed), and self-updates it on every start, because YouTube
 *   changes often and an old yt-dlp is the #1 reason music bots stop working.
 * - Always passes Node.js as yt-dlp's JavaScript runtime. Since late 2025
 *   YouTube playback needs a JS runtime, and Node is guaranteed to exist here.
 */

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config/config');

const IS_WIN = process.platform === 'win32';
const BIN_DIR = path.join(__dirname, '..', '..', 'bin');
const LOCAL_BIN = path.join(BIN_DIR, IS_WIN ? 'yt-dlp.exe' : 'yt-dlp');

function releaseAssetName() {
    if (IS_WIN) return 'yt-dlp.exe';
    if (process.platform === 'darwin') return 'yt-dlp_macos';
    if (process.platform === 'linux') {
        if (process.arch === 'arm64') return 'yt-dlp_linux_aarch64';
        if (process.arch === 'arm') return 'yt-dlp_linux_armv7l';
        return 'yt-dlp_linux';
    }
    return 'yt-dlp'; // generic build, needs python3
}

function binaryPath() {
    return config.ytdlpPath || LOCAL_BIN;
}

async function download() {
    const asset = releaseAssetName();
    const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
    console.log(`[yt-dlp] Downloading ${asset} ...`);
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(BIN_DIR, { recursive: true });
    const tmp = `${LOCAL_BIN}.part`;
    fs.writeFileSync(tmp, buffer, { mode: 0o755 });
    fs.renameSync(tmp, LOCAL_BIN);
    console.log(`[yt-dlp] Saved to ${LOCAL_BIN}`);
}

function version() {
    return new Promise(resolve => {
        execFile(binaryPath(), ['--version'], { timeout: 30_000, windowsHide: true }, (err, stdout) => {
            resolve(err ? null : stdout.trim());
        });
    });
}

function selfUpdate() {
    return new Promise(resolve => {
        execFile(binaryPath(), ['-U'], { timeout: 120_000, windowsHide: true }, (err, stdout, stderr) => {
            const out = `${stdout}${stderr}`.trim().split(/\r?\n/).pop();
            if (err) console.warn('[yt-dlp] Self-update failed (continuing with current version):', out);
            else console.log('[yt-dlp]', out);
            resolve();
        });
    });
}

/**
 * Make sure a working yt-dlp exists. Called once at startup.
 */
async function ensure() {
    if (config.ytdlpPath) {
        const v = await version();
        if (!v) throw new Error(`YTDLP_PATH is set to "${config.ytdlpPath}" but it could not be run.`);
        console.log(`[yt-dlp] Using ${config.ytdlpPath} (version ${v})`);
        return v;
    }
    if (!fs.existsSync(LOCAL_BIN)) {
        await download();
    } else if (config.ytdlpAutoUpdate) {
        await selfUpdate();
    }
    const v = await version();
    if (!v) throw new Error(`yt-dlp at ${LOCAL_BIN} could not be run.`);
    console.log(`[yt-dlp] Ready (version ${v})`);
    return v;
}

/**
 * yt-dlp writes updated cookies back to the cookies file, but files such as
 * Render "Secret Files" are read-only. So work on a private writable copy.
 * The cookies can also come straight from an env var (YTDLP_COOKIES_TEXT /
 * YTDLP_COOKIES_BASE64) for hosts without file support.
 */
let cookiesCopy;
function cookiesFile() {
    if (cookiesCopy !== undefined) return cookiesCopy;
    cookiesCopy = null;
    let text = null;
    try {
        if (config.ytdlpCookies) text = fs.readFileSync(config.ytdlpCookies, 'utf8');
        else if (process.env.YTDLP_COOKIES_BASE64) text = Buffer.from(process.env.YTDLP_COOKIES_BASE64, 'base64').toString('utf8');
        else if (process.env.YTDLP_COOKIES_TEXT) text = process.env.YTDLP_COOKIES_TEXT.replace(/\\n/g, '\n');
    } catch (err) {
        console.error(`[yt-dlp] Could not read cookies file ${config.ytdlpCookies}: ${err.message}`);
    }
    if (text && text.trim()) {
        const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'musicbot-'));
        cookiesCopy = path.join(dir, 'cookies.txt');
        fs.writeFileSync(cookiesCopy, text, { mode: 0o600 });
        console.log('[yt-dlp] Using YouTube cookies.');
    }
    return cookiesCopy;
}

/** Arguments every yt-dlp call gets. */
function baseArgs() {
    const args = [
        '--ignore-config',
        '--no-warnings',
        '--no-progress',
        '--js-runtimes', `node:${process.execPath}`,
        // Never fall back to the "generic" extractor, which would download any web page.
        '--use-extractors', 'default,-generic',
    ];
    const cookies = cookiesFile();
    if (cookies) args.push('--cookies', cookies);
    return args;
}

/**
 * Run yt-dlp and parse its JSON output.
 * @param {string} target URL or "ytsearchN:query"
 * @param {string[]} extra extra flags
 */
function getJson(target, extra = []) {
    const args = [...baseArgs(), '--dump-single-json', '--skip-download', ...extra, '--', target];
    return new Promise((resolve, reject) => {
        execFile(binaryPath(), args, { maxBuffer: 256 * 1024 * 1024, timeout: 120_000, windowsHide: true },
            (err, stdout, stderr) => {
                if (err) {
                    const msg = (stderr || err.message).trim().split(/\r?\n/).filter(l => l.startsWith('ERROR')).join('\n')
                        || (stderr || err.message).trim();
                    return reject(new Error(msg));
                }
                try {
                    resolve(JSON.parse(stdout));
                } catch (e) {
                    reject(new Error(`yt-dlp returned invalid JSON: ${e.message}`));
                }
            });
    });
}

/**
 * Spawn yt-dlp so that it writes the best audio-only stream of `url` to stdout.
 * yt-dlp does the download itself, which avoids the 403 errors YouTube now
 * returns when ffmpeg requests googlevideo URLs directly.
 */
function spawnAudio(url) {
    const args = [...baseArgs(), '--quiet', '--no-playlist', '-f', 'ba/ba*/b', '-o', '-', '--', url];
    return spawn(binaryPath(), args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

module.exports = { ensure, getJson, spawnAudio, version, binaryPath };
