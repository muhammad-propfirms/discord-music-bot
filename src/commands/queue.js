'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embed, respond, truncate } = require('../utils/helpers');
const PlayerManager = require('../player/PlayerManager');

const PER_PAGE = 10;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('queue')
        .setDescription('Show the songs in the queue.')
        .addIntegerOption(o => o.setName('page').setDescription('Page number').setMinValue(1)),

    async execute(interaction, client) {
        const queue = client.player.distube.getQueue(interaction.guildId);
        if (!queue || !queue.songs.length) return respond(interaction, 'info', 'The queue is empty. Use `/play` to add songs.', { ephemeral: true });

        const pages = Math.max(1, Math.ceil(queue.songs.length / PER_PAGE));
        const page = Math.min(interaction.options.getInteger('page') ?? 1, pages);
        const start = (page - 1) * PER_PAGE;

        const lines = queue.songs.slice(start, start + PER_PAGE).map((song, i) => {
            const n = start + i + 1;
            const line = `\`${n}.\` ${truncate(song.name, 70)} — \`${song.isLive ? 'LIVE' : song.formattedDuration}\``;
            return n === 1 ? `▶️ **${line}** *(playing — ${queue.formattedCurrentTime})*` : line;
        });

        const e = embed('info', lines.join('\n'), `🎶 Queue — ${queue.songs.length} song(s), ${queue.formattedDuration} total`)
            .setFooter({ text: `Page ${page}/${pages} • Volume ${queue.volume}% • Loop: ${PlayerManager.REPEAT_LABEL[queue.repeatMode]}${queue.paused ? ' • Paused' : ''}` });
        return interaction.reply({ embeds: [e] });
    },
};
