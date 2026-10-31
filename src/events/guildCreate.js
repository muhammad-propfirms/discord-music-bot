'use strict';

const config = require('../config/config');
const { registerCommands } = require('../utils/registerCommands');

module.exports = {
    name: 'guildCreate',
    async execute(guild, client) {
        console.log(`[BOT] Joined server: ${guild.name} (${guild.id})`);
        // If GUILD_ID is set, only those servers get commands.
        if (config.guildIds.length && !config.guildIds.includes(guild.id)) return;
        await registerCommands(client, guild.id);
    },
};
