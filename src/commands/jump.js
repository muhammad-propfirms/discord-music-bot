'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { respond, requireVoice, friendlyError, truncate } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('jump')
        .setDescription('Skip ahead to a song number from /queue.')
        .addIntegerOption(o => o.setName('position').setDescription('Song number shown in /queue').setRequired(true).setMinValue(2)),

    async execute(interaction) {
        const voice = await requireVoice(interaction, { needQueue: true });
        if (!voice) return;
        const position = interaction.options.getInteger('position', true);
        if (position > voice.queue.songs.length) {
            return respond(interaction, 'warn', `There are only ${voice.queue.songs.length} songs in the queue.`, { ephemeral: true });
        }
        try {
            const song = await voice.queue.jump(position - 1);
            return respond(interaction, 'ok', `⏭️ Jumped to **${truncate(song.name, 100)}**.`);
        } catch (error) {
            return respond(interaction, 'error', `❌ ${friendlyError(error)}`, { ephemeral: true });
        }
    },
};
