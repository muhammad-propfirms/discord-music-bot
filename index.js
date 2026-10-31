'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Collection, Events } = require('discord.js');
const config = require('./src/config/config');
const ytdlp = require('./src/player/ytdlp');
const PlayerManager = require('./src/player/PlayerManager');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
    console.error(`[FATAL] Node.js 22.12 or newer is required (you have ${process.version}). Install the LTS version from https://nodejs.org`);
    process.exit(1);
}

if (!config.token) {
    console.error('[FATAL] TOKEN is missing. Copy .env.example to .env and paste your bot token into it.');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

// ---- Commands -------------------------------------------------------------
client.commands = new Collection();
const commandsDir = path.join(__dirname, 'src', 'commands');
for (const file of fs.readdirSync(commandsDir).filter(f => f.endsWith('.js'))) {
    const command = require(path.join(commandsDir, file));
    if (!command.data?.name || typeof command.execute !== 'function') {
        throw new Error(`Invalid command file: ${file}`);
    }
    client.commands.set(command.data.name, command);
}
console.log(`[STARTUP] Loaded ${client.commands.size} commands: ${[...client.commands.keys()].join(', ')}`);

// ---- Events ---------------------------------------------------------------
const eventsDir = path.join(__dirname, 'src', 'events');
for (const file of fs.readdirSync(eventsDir).filter(f => f.endsWith('.js'))) {
    const event = require(path.join(eventsDir, file));
    const listener = async (...args) => {
        try {
            await event.execute(...args, client);
        } catch (error) {
            console.error(`[EVENT ERROR] ${event.name}:`, error);
        }
    };
    client[event.once ? 'once' : 'on'](event.name, listener);
}

client.on(Events.Error, error => console.error('[DISCORD] Client error:', error));
client.on(Events.Warn, warning => console.warn('[DISCORD] Warning:', warning));

// ---- Optional health-check web server (only when PORT is set) --------------
function startHealthServer() {
    if (!config.port) return;
    const express = require('express');
    const app = express();
    app.get('/', (req, res) => res.type('text').send('Music bot is running.'));
    app.get('/healthz', (req, res) => res.json({
        status: 'ok',
        discord: client.isReady() ? 'connected' : 'connecting',
        uptimeSeconds: Math.round(process.uptime()),
    }));
    app.listen(config.port, '0.0.0.0', () => console.log(`[WEB] Health check on port ${config.port}`))
        .on('error', err => console.error('[WEB] Could not start health server:', err.message));
}

// ---- Start ----------------------------------------------------------------
async function main() {
    console.log('[STARTUP] Checking yt-dlp...');
    await ytdlp.ensure();

    if (path.isAbsolute(config.ffmpegPath) && !fs.existsSync(config.ffmpegPath)) {
        console.warn(`[STARTUP] ffmpeg not found at ${config.ffmpegPath}. Set FFMPEG_PATH in .env.`);
    }

    client.player = new PlayerManager(client);
    await client.player.start();

    startHealthServer();

    console.log('[STARTUP] Logging in to Discord...');
    await client.login(config.token);
}

main().catch(error => {
    if (error?.code === 'TokenInvalid' || /token/i.test(error?.message ?? '')) {
        console.error('[FATAL] Discord rejected the token. Reset it in the Developer Portal (Bot -> Reset Token) and update .env.');
    } else if (/disallowed intents/i.test(error?.message ?? '')) {
        console.error('[FATAL] Discord refused the requested intents.');
    } else {
        console.error('[FATAL] Startup failed:', error);
    }
    process.exit(1);
});

process.on('unhandledRejection', error => console.error('[UNHANDLED REJECTION]', error));

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        console.log(`[SHUTDOWN] ${signal} received, disconnecting...`);
        try {
            client.player?.streamServer.stop();
            client.destroy();
        } finally {
            process.exit(0);
        }
    });
}
