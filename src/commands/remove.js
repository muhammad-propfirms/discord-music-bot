'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { respond, requireVoice, truncate } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Remove a song from the queue.')
        .addIntegerOption(o => o.setName('position').setDescription('Song number shown in /queue').setRequired(true).setMinValue(2)),

    async execute(interaction, client) {
        const voice = await requireVoice(interaction, { needQueue: true });
        if (!voice) return;
        const position = interaction.options.getInteger('position', true);
        if (position > voice.queue.songs.length) {
            return respond(interaction, 'warn', `There are only ${voice.queue.songs.length} songs in the queue.`, { ephemeral: true });
        }
        const [song] = voice.queue.songs.splice(position - 1, 1);
        client.player.streamServer.prefetch(voice.queue.songs[1]?.url);
        return respond(interaction, 'ok', `🗑️ Removed **${truncate(song.name, 100)}** from the queue.`);
    },
};
