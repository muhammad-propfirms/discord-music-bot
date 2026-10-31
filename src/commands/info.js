'use strict';

const { SlashCommandBuilder, EmbedBuilder, version: djsVersion } = require('discord.js');
const { version: distubeVersion } = require('distube');
const { COLORS } = require('../utils/helpers');
const ytdlp = require('../player/ytdlp');

function uptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
}

module.exports = {
    data: new SlashCommandBuilder().setName('info').setDescription('Show bot status and versions.'),

    async execute(interaction, client) {
        await interaction.deferReply();
        const e = new EmbedBuilder()
            .setColor(COLORS.info)
            .setTitle(`ℹ️ ${client.user.username}`)
            .setThumbnail(client.user.displayAvatarURL())
            .addFields(
                { name: 'Ping', value: `${Math.round(client.ws.ping)} ms`, inline: true },
                { name: 'Uptime', value: uptime(process.uptime()), inline: true },
                { name: 'Servers', value: String(client.guilds.cache.size), inline: true },
                { name: 'Playing in', value: `${client.player.distube.queues.collection.size} server(s)`, inline: true },
                { name: 'Node.js', value: process.version, inline: true },
                { name: 'yt-dlp', value: (await ytdlp.version()) ?? 'not found', inline: true },
                { name: 'discord.js / DisTube', value: `${djsVersion} / ${distubeVersion}`, inline: true },
            );
        return interaction.editReply({ embeds: [e] });
    },
};
