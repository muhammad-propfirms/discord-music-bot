'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { respond, requireVoice, friendlyError } = require('../utils/helpers');

/** "90", "1:30", "1:02:03" -> seconds */
function parseTime(text) {
    const parts = text.trim().split(':').map(p => p.trim());
    if (!parts.length || parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) return null;
    return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('seek')
        .setDescription('Jump to a time in the current song.')
        .addStringOption(o => o.setName('time').setDescription('e.g. 90 or 1:30').setRequired(true)),

    async execute(interaction) {
        const voice = await requireVoice(interaction, { needQueue: true });
        if (!voice) return;
        const { queue } = voice;
        const song = queue.songs[0];
        const seconds = parseTime(interaction.options.getString('time', true));
        if (seconds === null) return respond(interaction, 'warn', 'Use a time like `90` or `1:30`.', { ephemeral: true });
        if (song.isLive) return respond(interaction, 'warn', "You can't seek in a live stream.", { ephemeral: true });
        if (song.duration && seconds >= song.duration) {
            return respond(interaction, 'warn', `That's past the end of the song (\`${song.formattedDuration}\`).`, { ephemeral: true });
        }
        await interaction.deferReply();
        try {
            await queue.seek(seconds);
        } catch (error) {
            return respond(interaction, 'error', `❌ ${friendlyError(error)}`);
        }
        const m = Math.floor(seconds / 60);
        return respond(interaction, 'ok', `⏩ Jumped to \`${m}:${String(seconds % 60).padStart(2, '0')}\`.`);
    },
};
