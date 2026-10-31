'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { Playlist, isURL } = require('distube');
const YtDlpPlugin = require('../player/YtDlpPlugin');
const { respond, requireVoice, friendlyError, truncate } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or playlist by name or link.')
        .addStringOption(o => o
            .setName('query')
            .setDescription('Song name, or a YouTube / SoundCloud / Spotify track link')
            .setRequired(true))
        .addBooleanOption(o => o
            .setName('next')
            .setDescription('Put it at the front of the queue instead of the end')),

    async execute(interaction) {
        const voice = await requireVoice(interaction);
        if (!voice) return;
        const { channel, distube } = voice;
        const query = interaction.options.getString('query', true).trim();
        const next = interaction.options.getBoolean('next') ?? false;

        await interaction.deferReply();
        await playAndReport(interaction, distube, channel, query, next);
    },

    playAndReport,
};

/** Resolve a query/URL, add it to the queue and edit the deferred reply. Shared with /search. */
async function playAndReport(interaction, distube, channel, query, next = false) {
    // Anything that looks like a link must be on the allowlist, and from here on we only
    // use the normalized form, so DisTube/yt-dlp fetch exactly the URL that was checked.
    if (isURL(query) || /^[a-z][a-z0-9+.-]*:[\\/]/i.test(query)) {
        const normalized = YtDlpPlugin.normalizeAllowedUrl(query);
        if (!normalized) {
            return respond(interaction, 'warn',
                '🚫 Only links from YouTube, SoundCloud, Bandcamp, Spotify (tracks), Vimeo, Twitch, Mixcloud, Audiomack, Deezer and Dailymotion are supported. Or just type the song name.');
        }
        query = normalized;
    }
    let item;
    try {
        item = await distube.handler.resolve(query, { member: interaction.member });
    } catch (error) {
        console.error('[PLAY] Resolve failed:', error.message);
        return respond(interaction, 'error', `❌ ${friendlyError(error)}`);
    }

    const wasPlaying = Boolean(distube.getQueue(interaction.guildId)?.songs.length);
    try {
        await distube.play(channel, item, {
            member: interaction.member,
            textChannel: interaction.channel,
            position: next ? 1 : 0,
        });
    } catch (error) {
        console.error('[PLAY] Play failed:', error.message);
        return respond(interaction, 'error', `❌ ${friendlyError(error)}`);
    }

    const queue = distube.getQueue(interaction.guildId);
    if (item instanceof Playlist) {
        return respond(interaction, 'ok',
            `📃 Added playlist **[${truncate(item.name, 100)}](${item.url})** — ${item.songs.length} songs.`);
    }
    const title = `**[${truncate(item.name, 120)}](${item.url})** \`${item.isLive ? 'LIVE' : item.formattedDuration}\``;
    if (!wasPlaying) return respond(interaction, 'ok', `▶️ Starting ${title}`);
    const position = queue ? queue.songs.indexOf(item) : -1;
    return respond(interaction, 'ok', `➕ Added ${title}${position > 0 ? ` at position **#${position + 1}**` : ''}.`);
}
