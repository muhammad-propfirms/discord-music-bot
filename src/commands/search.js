'use strict';

const {
    SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags,
} = require('discord.js');
const { embed, respond, requireVoice, friendlyError, truncate } = require('../utils/helpers');
const { playAndReport } = require('./play');

function fmt(seconds) {
    if (!seconds) return 'live/?';
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('Search YouTube and pick a result to play.')
        .addStringOption(o => o.setName('query').setDescription('What to search for').setRequired(true)),

    async execute(interaction, client) {
        const voice = await requireVoice(interaction);
        if (!voice) return;
        const query = interaction.options.getString('query', true).trim();

        await interaction.deferReply();
        let results;
        try {
            results = await client.player.plugin.search(query, 5);
        } catch (error) {
            return respond(interaction, 'error', `❌ ${friendlyError(error)}`);
        }
        if (!results.length) return respond(interaction, 'warn', 'No results found.');

        const list = results.map((r, i) =>
            `**${i + 1}.** ${truncate(r.title || 'Untitled', 90)} — \`${fmt(r.duration)}\`${r.channel || r.uploader ? ` · ${r.channel || r.uploader}` : ''}`,
        ).join('\n');

        const row = new ActionRowBuilder().addComponents(
            results.map((_, i) => new ButtonBuilder().setCustomId(`pick_${i}`).setLabel(String(i + 1)).setStyle(ButtonStyle.Primary)),
        );
        const cancelRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('pick_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
        );

        const message = await interaction.editReply({
            embeds: [embed('info', `${list}\n\nPick a number within 30 seconds.`, `🔎 Results for "${truncate(query, 60)}"`)],
            components: [row, cancelRow],
        });

        let button;
        try {
            button = await message.awaitMessageComponent({
                componentType: ComponentType.Button,
                time: 30_000,
                filter: async i => {
                    if (i.user.id === interaction.user.id) return true;
                    await i.reply({ content: 'Only the person who searched can pick. Use `/search` yourself!', flags: MessageFlags.Ephemeral }).catch(() => {});
                    return false;
                },
            });
        } catch {
            return interaction.editReply({ embeds: [embed('warn', '⌛ Search timed out.')], components: [] }).catch(() => {});
        }

        await button.deferUpdate().catch(() => {});
        if (button.customId === 'pick_cancel') {
            return interaction.editReply({ embeds: [embed('info', 'Search cancelled.')], components: [] }).catch(() => {});
        }

        const picked = results[Number(button.customId.split('_')[1])];
        await interaction.editReply({ embeds: [embed('info', `⏳ Loading **${truncate(picked.title || 'song', 100)}**…`)], components: [] });

        // Re-check voice: the user may have left while choosing.
        const again = await requireVoice(interaction);
        if (!again) return;
        const url = picked.url || `https://www.youtube.com/watch?v=${picked.id}`;
        await playAndReport(interaction, again.distube, again.channel, url);
    },
};
