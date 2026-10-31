'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { respond, requireVoice } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the upcoming songs.'),

    async execute(interaction, client) {
        const voice = await requireVoice(interaction, { needQueue: true });
        if (!voice) return;
        if (voice.queue.songs.length < 3) return respond(interaction, 'warn', 'Need at least 2 upcoming songs to shuffle.', { ephemeral: true });
        await voice.queue.shuffle();
        client.player.streamServer.prefetch(voice.queue.songs[1]?.url);
        return respond(interaction, 'ok', `🔀 Shuffled ${voice.queue.songs.length - 1} upcoming songs.`);
    },
};
