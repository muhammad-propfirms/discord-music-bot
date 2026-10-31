'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { respond, requireVoice, friendlyError, truncate } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current song.'),

    async execute(interaction) {
        const voice = await requireVoice(interaction, { needQueue: true });
        if (!voice) return;
        const { queue } = voice;
        const current = queue.songs[0];
        try {
            if (queue.songs.length > 1) {
                await queue.skip();
                return respond(interaction, 'ok', `⏭️ Skipped **${truncate(current?.name ?? 'song', 100)}**.`);
            }
            await queue.stop();
            return respond(interaction, 'ok', `⏭️ Skipped **${truncate(current?.name ?? 'song', 100)}**. The queue is now empty.`);
        } catch (error) {
            return respond(interaction, 'error', `❌ ${friendlyError(error)}`, { ephemeral: true });
        }
    },
};
