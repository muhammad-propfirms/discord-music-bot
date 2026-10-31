'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { respond, requireVoice } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder().setName('resume').setDescription('Resume the paused song.'),

    async execute(interaction) {
        const voice = await requireVoice(interaction, { needQueue: true });
        if (!voice) return;
        if (!voice.queue.paused) return respond(interaction, 'warn', 'The music is not paused.', { ephemeral: true });
        await voice.queue.resume();
        return respond(interaction, 'ok', '▶️ Resumed.');
    },
};
