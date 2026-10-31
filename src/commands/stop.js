'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { respond, requireVoice } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder().setName('stop').setDescription('Stop the music, clear the queue and leave the voice channel.'),

    async execute(interaction) {
        const voice = await requireVoice(interaction);
        if (!voice) return;
        const { queue, distube } = voice;
        if (queue) await queue.stop().catch(() => {});
        distube.voices.leave(interaction.guildId);
        return respond(interaction, 'ok', '⏹️ Stopped and cleared the queue. Bye!');
    },
};
