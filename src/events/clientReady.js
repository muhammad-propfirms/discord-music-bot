'use strict';

const { ActivityType } = require('discord.js');
const config = require('../config/config');
const { registerCommands } = require('../utils/registerCommands');

module.exports = {
    name: 'clientReady',
    once: true,

    async execute(client) {
        console.log('================================');
        console.log(`[BOT] Logged in as ${client.user.tag} (id ${client.user.id})`);
        console.log(`[BOT] In ${client.guilds.cache.size} server(s): ${client.guilds.cache.map(g => g.name).join(', ') || '(none yet)'}`);
        console.log('================================');

        client.user.setActivity('/play', { type: ActivityType.Listening });

        if (client.guilds.cache.size === 0) {
            console.warn('[BOT] The bot is not in any server yet. Invite it with this link:');
            console.warn(`      ${inviteUrl(client.user.id)}`);
        }

        const targets = config.guildIds.length
            ? config.guildIds
            : [...client.guilds.cache.keys()];

        for (const guildId of targets) {
            await registerCommands(client, guildId);
        }
    },
};

function inviteUrl(clientId) {
    // Permissions: View Channels, Send Messages, Embed Links, Read Message History, Connect, Speak
    const permissions = 1024n + 2048n + 16384n + 65536n + 1048576n + 2097152n;
    return `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=bot%20applications.commands`;
}
