'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder().setName('leave').setDescription('Make the bot leave the voice channel.'),

    async execute(interaction, client) {
        const distube = client.player.distube;
        const queue = distube.getQueue(interaction.guildId);
        if (!interaction.guild.members.me?.voice?.channel) {
            return respond(interaction, 'warn', "I'm not in a voice channel.", { ephemeral: true });
        }
        if (queue) await queue.stop().catch(() => {});
        distube.voices.leave(interaction.guildId);
        return respond(interaction, 'ok', '👋 Left the voice channel.');
    },
};
