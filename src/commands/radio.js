'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { Playlist, isURL } = require('distube');
const YtDlpPlugin = require('../player/YtDlpPlugin');
const { respond, requireVoice, friendlyError, truncate } = require('../utils/helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('radio')
        .setDescription('Type a song, artist or mood: plays the best match plus related songs, then keeps going.')
        .addStringOption(o => o
            .setName('query')
            .setDescription('e.g. "the weeknd blinding lights", "90s rock", "lofi chill", or a YouTube link')
            .setRequired(true))
        .addIntegerOption(o => o
            .setName('songs')
            .setDescription('How many related songs to queue (default 15)')
            .setMinValue(1)
            .setMaxValue(50)),

    async execute(interaction, client) {
        const voice = await requireVoice(interaction);
        if (!voice) return;
        const { channel, distube } = voice;
        const plugin = client.player.plugin;
        const count = interaction.options.getInteger('songs') ?? 15;
        let query = interaction.options.getString('query', true).trim();

        await interaction.deferReply();

        // 1. Find the starting song from the text (or link) the user typed.
        let seed;
        try {
            if (isURL(query) || /^[a-z][a-z0-9+.-]*:[\\/]/i.test(query)) {
                query = YtDlpPlugin.normalizeAllowedUrl(query);
                if (!query) return respond(interaction, 'warn', '🚫 That link is not from a supported site. Try typing the song name instead.');
                const resolved = await plugin.resolve(query, { member: interaction.member });
                seed = resolved instanceof Playlist ? resolved.songs[0] : resolved;
            } else {
                const match = await plugin.findSong(query);
                seed = match ? plugin.toSong(match, { member: interaction.member }) : null;
            }
        } catch (error) {
            return respond(interaction, 'error', `❌ ${friendlyError(error)}`);
        }
        if (!seed) return respond(interaction, 'warn', `No songs found for "${truncate(query, 80)}".`);

        // 2. Get related songs (YouTube's "Mix" for that song).
        const related = (await plugin.getRelatedSongs(seed, count)).slice(0, count);

        // 3. Queue them all as one "playlist" and switch autoplay on so the music keeps going.
        const radio = new Playlist({
            source: 'youtube',
            songs: [seed, ...related],
            name: `Radio: ${seed.name}`,
            url: seed.url,
            thumbnail: seed.thumbnail,
        }, { member: interaction.member });

        try {
            await distube.play(channel, radio, { member: interaction.member, textChannel: interaction.channel });
        } catch (error) {
            return respond(interaction, 'error', `❌ ${friendlyError(error)}`);
        }

        const queue = distube.getQueue(interaction.guildId);
        if (queue && !queue.autoplay) queue.toggleAutoplay();

        const preview = related.slice(0, 5).map((s, i) => `\`${i + 1}.\` ${truncate(s.name, 70)}`).join('\n');
        return respond(interaction, 'ok',
            `📻 **Radio started from [${truncate(seed.name, 100)}](${seed.url})**\n` +
            `Queued ${related.length} related song(s). Autoplay is **on**, so similar music keeps playing when the queue runs out.` +
            (preview ? `\n\n**Coming up:**\n${preview}${related.length > 5 ? `\n…and ${related.length - 5} more` : ''}` : '') +
            '\n\nTurn it off any time with `/autoplay`.');
    },
};
