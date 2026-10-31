'use strict';

const config = require('../config/config');
const { respond, isAllowed } = require('../utils/helpers');

module.exports = {
    name: 'interactionCreate',

    async execute(interaction, client) {
        if (!interaction.isChatInputCommand()) return;

        if (!interaction.inGuild()) {
            await respond(interaction, 'warn', 'Music commands only work inside a server.', { ephemeral: true });
            return;
        }

        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        if (!isAllowed(interaction, config)) {
            await respond(interaction, 'warn', '🔒 You are not allowed to use this bot.', { ephemeral: true });
            return;
        }

        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error(`[COMMAND ERROR] /${interaction.commandName}:`, error);
            await respond(interaction, 'error', '❌ Something went wrong running that command.', { ephemeral: true });
        }
    },
};
