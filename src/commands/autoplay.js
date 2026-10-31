'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { respond, requireVoice } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autoplay')
        .setDescription('When the queue runs out, keep playing related songs automatically.')
        .addStringOption(o => o
            .setName('mode')
            .setDescription('Leave empty to toggle')
            .addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })),

    async execute(interaction, client) {
        const voice = await requireVoice(interaction, { needQueue: true });
        if (!voice) return;
        const { queue } = voice;
        const mode = interaction.options.getString('mode');
        const want = mode === null ? !queue.autoplay : mode === 'on';
        if (queue.autoplay !== want) queue.toggleAutoplay();
        if (queue.autoplay) {
            // Line up the next related song now (in the background) so it starts without a gap.
            client.player.ensureUpNext(queue).then(() => client.player.prefetchNext(queue)).catch(() => {});
        }
        return respond(interaction, 'ok', queue.autoplay
            ? '♾️ Autoplay is **on**. When the queue runs out, I\'ll keep playing songs related to the last one.'
            : '⏹️ Autoplay is **off**. I\'ll stop when the queue runs out.');
    },
};
