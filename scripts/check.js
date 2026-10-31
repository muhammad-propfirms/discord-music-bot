'use strict';

/**
 * Self-test: run `npm run check` to verify everything the bot needs, without
 * joining Discord voice. It checks Node, ffmpeg, yt-dlp, the voice libraries,
 * real YouTube playback through the same pipeline the bot uses, and your token.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));

const config = require('../src/config/config');
const ytdlp = require('../src/player/ytdlp');
const StreamServer = require('../src/player/StreamServer');

let failures = 0;
const ok = msg => console.log(`  ✅ ${msg}`);
const bad = msg => { failures++; console.log(`  ❌ ${msg}`); };
const step = title => console.log(`\n▶ ${title}`);

function decodeSeconds(url, seconds) {
    return new Promise(resolve => {
        const ff = spawn(config.ffmpegPath, ['-loglevel', 'error', '-i', url, '-t', String(seconds), '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
            { windowsHide: true });
        let bytes = 0;
        let err = '';
        ff.stdout.on('data', d => { bytes += d.length; });
        ff.stderr.on('data', d => { err += d; });
        ff.on('error', e => resolve({ bytes: 0, err: e.message }));
        ff.on('close', () => resolve({ bytes, err: err.trim() }));
    });
}

async function main() {
    step('Node.js');
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major > 22 || (major === 22 && minor >= 12)) ok(`Node ${process.version}`);
    else bad(`Node ${process.version} is too old. Install Node 22 LTS or newer.`);

    step('ffmpeg');
    const ffVersion = await new Promise(resolve => {
        const p = spawn(config.ffmpegPath, ['-version'], { windowsHide: true });
        let out = '';
        p.stdout.on('data', d => { out += d; });
        p.on('error', () => resolve(null));
        p.on('close', code => resolve(code === 0 ? out.split('\n')[0] : null));
    });
    if (ffVersion) ok(ffVersion); else bad(`ffmpeg could not be run from ${config.ffmpegPath}`);

    step('Discord voice libraries');
    try {
        const { generateDependencyReport } = require('@discordjs/voice');
        const report = generateDependencyReport();
        const opus = /opusscript: \d|@discordjs\/opus: \d/.test(report);
        const dave = /@snazzah\/davey: \d/.test(report);
        if (opus) ok('Opus encoder found'); else bad('No Opus encoder (opusscript or @discordjs/opus). Run npm install.');
        if (dave) ok('DAVE end-to-end voice encryption library found (required by Discord since 2026)');
        else bad('@snazzah/davey missing. Run npm install.');
    } catch (e) {
        bad(`@discordjs/voice failed to load: ${e.message}`);
    }

    step('yt-dlp');
    try {
        const v = await ytdlp.ensure();
        ok(`yt-dlp ${v}`);
    } catch (e) {
        bad(e.message);
        return;
    }

    step('YouTube search');
    let video;
    try {
        const info = await ytdlp.getJson('ytsearch1:rick astley never gonna give you up', ['--flat-playlist']);
        video = info.entries?.[0];
        if (!video) throw new Error('no results');
        ok(`Found "${video.title}"`);
    } catch (e) {
        bad(`Search failed: ${e.message.split('\n')[0]}`);
        if (/not a bot/i.test(e.message)) console.log('     YouTube is blocking this IP. Set YTDLP_COOKIES (see the guide).');
        return;
    }

    step('YouTube audio playback (same path the bot uses)');
    const server = new StreamServer();
    await server.start();
    try {
        const started = Date.now();
        const { bytes, err } = await decodeSeconds(server.urlFor(video.url || `https://www.youtube.com/watch?v=${video.id}`), 5);
        const expected = 5 * 48000 * 4;
        if (bytes >= expected * 0.9) ok(`Decoded 5 seconds of audio in ${((Date.now() - started) / 1000).toFixed(1)}s`);
        else bad(`Only got ${bytes} of ${expected} audio bytes. ${err}`);
    } finally {
        server.stop();
    }

    step('Discord bot token');
    if (!config.token) {
        bad('TOKEN is not set in .env');
    } else {
        try {
            const res = await fetch('https://discord.com/api/v10/users/@me', {
                headers: { Authorization: `Bot ${config.token}` },
                signal: AbortSignal.timeout(15_000),
            });
            if (res.ok) {
                const me = await res.json();
                ok(`Token is valid for bot "${me.username}" (id ${me.id})`);
                const permissions = 1024n + 2048n + 16384n + 65536n + 1048576n + 2097152n;
                console.log(`     Invite link: https://discord.com/oauth2/authorize?client_id=${me.id}&permissions=${permissions}&scope=bot%20applications.commands`);
            } else if (res.status === 401) {
                bad('Discord says the token is invalid. Reset it in the Developer Portal and update .env.');
            } else {
                bad(`Discord API returned HTTP ${res.status}`);
            }
        } catch (e) {
            bad(`Could not reach Discord: ${e.message}`);
        }
    }
}

main()
    .catch(e => bad(e.stack || e.message))
    .finally(() => {
        console.log(failures ? `\n${failures} problem(s) found.` : '\nAll checks passed. Start the bot with: npm start');
        process.exit(failures ? 1 : 0);
    });
