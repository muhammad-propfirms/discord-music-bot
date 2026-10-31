'use strict';

const { EmbedBuilder, MessageFlags } = require('discord.js');

const COLORS = {
    ok: 0x2ecc71,
    info: 0x5865f2,
    warn: 0xf1c40f,
    error: 0xe74c3c,
};

function embed(kind, description, title) {
    const e = new EmbedBuilder().setColor(COLORS[kind] ?? COLORS.info).setDescription(description);
    if (title) e.setTitle(title);
    return e;
}

/** Reply (or edit the deferred reply) with an embed. Never throws. */
async function respond(interaction, kind, description, { title, ephemeral = false } = {}) {
    const payload = { embeds: [embed(kind, description, title)] };
    try {
        if (interaction.deferred || interaction.replied) {
            return await interaction.editReply(payload);
        }
        if (ephemeral) payload.flags = MessageFlags.Ephemeral;
        return await interaction.reply(payload);
    } catch (err) {
        console.error('[REPLY] Could not respond to interaction:', err.message);
        return null;
    }
}

/**
 * Check the user is in a voice channel (and the same one as the bot, if the bot is
 * already playing somewhere). Replies with an error and returns null if not.
 * @param {{ needQueue?: boolean }} opts
 */
async function requireVoice(interaction, { needQueue = false } = {}) {
    const channel = interaction.member?.voice?.channel;
    if (!channel) {
        await respond(interaction, 'warn', '🎧 Join a voice channel first.', { ephemeral: true });
        return null;
    }
    const distube = interaction.client.player.distube;
    const queue = distube.getQueue(interaction.guildId);
    const botChannel = interaction.guild.members.me?.voice?.channel;
    if (botChannel && botChannel.id !== channel.id && queue) {
        await respond(interaction, 'warn', `I'm already playing in ${botChannel}. Join that channel to control the music.`, { ephemeral: true });
        return null;
    }
    if (needQueue && !queue) {
        await respond(interaction, 'warn', 'Nothing is playing right now. Use `/play` to start.', { ephemeral: true });
        return null;
    }
    return { channel, queue, distube };
}

/** Turn a DisTube / yt-dlp error into a short message a person can act on. */
function friendlyError(error) {
    const code = error?.errorCode;
    const msg = String(error?.message || error || '');
    if (/Sign in to confirm|not a bot/i.test(msg)) {
        return 'YouTube is blocking this server\'s IP ("confirm you\'re not a bot"). The bot owner needs to add YouTube cookies — see the setup guide, section "YouTube blocks".';
    }
    if (/Private video|This video is private/i.test(msg)) return 'That video is private.';
    if (/confirm your age|age[- ]restricted|inappropriate for some users/i.test(msg)) return 'That video is age-restricted. The bot owner can add YouTube cookies to allow it.';
    if (/Video unavailable|not available/i.test(msg)) return 'That video is unavailable (removed or region-locked).';
    if (/Unsupported URL/i.test(msg)) return 'That link is not supported.';
    switch (code) {
        case 'NO_RESULT': return 'No results found for that search.';
        case 'NO_QUEUE': return 'Nothing is playing right now.';
        case 'NO_UP_NEXT': return 'There is no next song in the queue.';
        case 'NO_PREVIOUS': return 'There is no previous song.';
        case 'VOICE_FULL': return 'That voice channel is full.';
        case 'VOICE_MISSING_PERMS': return 'I don\'t have permission to join or speak in that voice channel.';
        case 'VOICE_CONNECT_FAILED': return 'Could not connect to the voice channel. Please try again.';
        case 'NON_NSFW': return 'That song is age-restricted and can only be played in an age-restricted (NSFW) channel.';
        case 'YTDLP_ERROR': return msg.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]+:\s*)?/i, '').slice(0, 300) || 'Could not load that song.';
        default: return msg ? msg.slice(0, 300) : 'Something went wrong.';
    }
}

/** Is this member allowed to use the bot (ALLOWED_USER_IDS / ALLOWED_ROLE_IDS)? */
function isAllowed(interaction, config) {
    if (!config.allowedUserIds.length && !config.allowedRoleIds.length) return true;
    if (config.allowedUserIds.includes(interaction.user.id)) return true;
    const roles = interaction.member?.roles?.cache;
    return Boolean(roles && config.allowedRoleIds.some(id => roles.has(id)));
}

function truncate(text, max) {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

module.exports = { COLORS, embed, respond, requireVoice, friendlyError, isAllowed, truncate };
