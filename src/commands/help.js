'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { embed } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder().setName('help').setDescription('List all commands.'),

    async execute(interaction, client) {
        const lines = [...client.commands.values()]
            .sort((a, b) => a.data.name.localeCompare(b.data.name))
            .map(c => `**/${c.data.name}** — ${c.data.description}`);
        const tip = 'Tip: `/play` accepts a song title or any text, a YouTube/SoundCloud link, a playlist link or a Spotify track link. '
            + 'Use `/radio` with a song, artist or mood (e.g. `/radio 90s rock`) to get related music that keeps playing.';
        return interaction.reply({ embeds: [embed('info', `${lines.join('\n')}\n\n${tip}`, '🎵 Music bot commands')] });
    },
};
