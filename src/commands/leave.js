'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { respond, requireVoice } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder().setName('leave').setDescription('Make the bot leave the voice channel.'),

    async execute(interaction) {
        if (!interaction.guild.members.me?.voice?.channel) {
            return respond(interaction, 'warn', "I'm not in a voice channel.", { ephemeral: true });
        }
        // Same rule as /stop: you must be in the bot's voice channel to make it leave.
        const voice = await requireVoice(interaction);
        if (!voice) return;
        if (voice.queue) await voice.queue.stop().catch(() => {});
        voice.distube.voices.leave(interaction.guildId);
        return respond(interaction, 'ok', '👋 Left the voice channel.');
    },
};
