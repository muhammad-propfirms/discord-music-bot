'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { RepeatMode } = require('distube');
const { respond, requireVoice } = require('../utils/helpers');

const MODES = { off: RepeatMode.DISABLED, song: RepeatMode.SONG, queue: RepeatMode.QUEUE };
const TEXT = {
    [RepeatMode.DISABLED]: '➡️ Loop is **off**.',
    [RepeatMode.SONG]: '🔂 Looping **this song**.',
    [RepeatMode.QUEUE]: '🔁 Looping **the whole queue**.',
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('loop')
        .setDescription('Repeat the current song or the whole queue.')
        .addStringOption(o => o
            .setName('mode')
            .setDescription('What to repeat')
            .setRequired(true)
            .addChoices(
                { name: 'Off', value: 'off' },
                { name: 'This song', value: 'song' },
                { name: 'Whole queue', value: 'queue' },
            )),

    async execute(interaction) {
        const voice = await requireVoice(interaction, { needQueue: true });
        if (!voice) return;
        const mode = MODES[interaction.options.getString('mode', true)];
        // setRepeatMode() toggles to "off" when given the current mode, so only call it on a change.
        if (voice.queue.repeatMode !== mode) voice.queue.setRepeatMode(mode);
        return respond(interaction, 'ok', TEXT[mode]);
    },
};
