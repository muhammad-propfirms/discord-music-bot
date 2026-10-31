'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { respond, requireVoice } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder().setName('pause').setDescription('Pause the current song.'),

    async execute(interaction) {
        const voice = await requireVoice(interaction, { needQueue: true });
        if (!voice) return;
        if (voice.queue.paused) return respond(interaction, 'warn', 'Already paused. Use `/resume`.', { ephemeral: true });
        await voice.queue.pause();
        return respond(interaction, 'ok', '⏸️ Paused.');
    },
};
