'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { respond, requireVoice, friendlyError, truncate } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder().setName('previous').setDescription('Play the previous song again.'),

    async execute(interaction) {
        const voice = await requireVoice(interaction, { needQueue: true });
        if (!voice) return;
        try {
            const song = await voice.queue.previous();
            return respond(interaction, 'ok', `⏮️ Playing **${truncate(song.name, 100)}** again.`);
        } catch (error) {
            return respond(interaction, 'error', `❌ ${friendlyError(error)}`, { ephemeral: true });
        }
    },
};
