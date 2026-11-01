'use strict';

/**
 * All settings come from environment variables (the .env file).
 * See .env.example for what each one does.
 */

require('dotenv').config({ quiet: true });

const int = (value, fallback) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
};

function bundledFfmpeg() {
    try {
        const p = require('ffmpeg-static');
        if (p && require('node:fs').existsSync(p)) return p;
    } catch {
        // not installed
    }
    return 'ffmpeg'; // fall back to ffmpeg on the system PATH
}

const list = value => (value || '').split(',').map(s => s.trim()).filter(Boolean);

module.exports = {
    token: (process.env.TOKEN || process.env.DISCORD_TOKEN || '').trim(),

    // Servers to register slash commands in. Empty = every server the bot is in.
    guildIds: list(process.env.GUILD_ID),

    // Optional: only these Discord user IDs / role IDs may use the bot. Empty = everyone.
    allowedUserIds: list(process.env.ALLOWED_USER_IDS),
    allowedRoleIds: list(process.env.ALLOWED_ROLE_IDS),

    defaultVolume: Math.min(Math.max(int(process.env.DEFAULT_VOLUME, 50), 0), 100),
    maxPlaylistSize: Math.max(int(process.env.MAX_PLAYLIST_SIZE, 100), 1),

    // Leave the voice channel after this many seconds alone / idle. 0 = never.
    leaveWhenAloneAfter: Math.max(int(process.env.LEAVE_WHEN_ALONE_AFTER, 60), 0),
    leaveWhenIdleAfter: Math.max(int(process.env.LEAVE_WHEN_IDLE_AFTER, 300), 0),

    // yt-dlp
    ytdlpPath: (process.env.YTDLP_PATH || '').trim(),
    // Path to a cookies.txt. On Render, a Secret File named cookies.txt is picked up automatically.
    ytdlpCookies: (process.env.YTDLP_COOKIES || '').trim()
        || (require('node:fs').existsSync('/etc/secrets/cookies.txt') ? '/etc/secrets/cookies.txt' : ''),
    ytdlpAutoUpdate: process.env.YTDLP_AUTO_UPDATE !== 'false',

    // ffmpeg: use FFMPEG_PATH if set, otherwise the copy bundled by ffmpeg-static.
    ffmpegPath: (process.env.FFMPEG_PATH || '').trim() || bundledFfmpeg(),

    // If YouTube blocks a song on this server, play the same song from SoundCloud instead.
    soundcloudFallback: process.env.SOUNDCLOUD_FALLBACK !== 'false',

    // Give up on a song (or try SoundCloud) if no audio arrived after this many seconds. 0 = wait forever.
    streamStartTimeout: Math.max(int(process.env.STREAM_START_TIMEOUT, 150), 0),

    // Health-check web server (needed on Render/Railway). See resolvePort().
    ...resolvePort(),
};

/**
 * Render sets PORT itself (10000). If someone overrides it with a wrong value,
 * the web server would not start and Render waits forever ("No open ports
 * detected"), so on Render we always fall back to 10000.
 */
function resolvePort() {
    const raw = (process.env.PORT ?? '').trim();
    const onRender = Boolean(process.env.RENDER);
    if (/^\d{2,5}$/.test(raw) && Number(raw) > 0 && Number(raw) < 65536) return { port: Number(raw), portWarning: null };
    const portWarning = raw
        ? `PORT is set to "${raw.slice(0, 40)}", which is not a valid port number.`
          + (onRender ? ' Using 10000 instead. Delete the PORT variable in Render > Environment: Render sets it automatically.' : ' The health-check server is disabled.')
        : null;
    return { port: onRender ? 10000 : 0, portWarning };
}
