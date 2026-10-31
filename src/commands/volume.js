'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { respond, requireVoice } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Show or set the volume (0-150).')
        .addIntegerOption(o => o.setName('percent').setDescription('New volume, 0-150').setMinValue(0).setMaxValue(150)),

    async execute(interaction) {
        const voice = await requireVoice(interaction, { needQueue: true });
        if (!voice) return;
        const percent = interaction.options.getInteger('percent');
        if (percent === null) return respond(interaction, 'info', `🔊 Volume is **${voice.queue.volume}%**.`);
        voice.queue.setVolume(percent);
        return respond(interaction, 'ok', `${percent === 0 ? '🔇' : '🔊'} Volume set to **${percent}%**.`);
    },
};
