'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { respond } = require('../utils/helpers');

function bar(current, total, size = 18) {
    if (!total) return '';
    const filled = Math.min(size, Math.round((current / total) * size));
    return `${'▬'.repeat(filled)}🔘${'▬'.repeat(size - filled)}`;
}

module.exports = {
    data: new SlashCommandBuilder().setName('nowplaying').setDescription('Show the song that is playing now.'),

    async execute(interaction, client) {
        const queue = client.player.distube.getQueue(interaction.guildId);
        const song = queue?.songs[0];
        if (!song) return respond(interaction, 'info', 'Nothing is playing right now.', { ephemeral: true });
        const e = client.player.nowPlayingEmbed(queue, song);
        if (!song.isLive) {
            e.setDescription(`${bar(queue.currentTime, song.duration)}\n\`${queue.formattedCurrentTime} / ${song.formattedDuration}\`${queue.paused ? ' ⏸️' : ''}`);
        }
        return interaction.reply({ embeds: [e] });
    },
};
