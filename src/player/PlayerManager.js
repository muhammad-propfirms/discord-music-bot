'use strict';

const { DisTube, RepeatMode } = require('distube');
const { EmbedBuilder } = require('discord.js');
const StreamServer = require('./StreamServer');
const YtDlpPlugin = require('./YtDlpPlugin');
const config = require('../config/config');
const { COLORS, embed, friendlyError, truncate } = require('../utils/helpers');

const REPEAT_LABEL = {
    [RepeatMode.DISABLED]: 'Off',
    [RepeatMode.SONG]: 'Song',
    [RepeatMode.QUEUE]: 'Queue',
};

class PlayerManager {
    /** @param {import('discord.js').Client} client */
    constructor(client) {
        this.client = client;
        this.streamServer = new StreamServer();
        this.plugin = new YtDlpPlugin(this.streamServer);

        this.distube = new DisTube(client, {
            plugins: [this.plugin],
            emitNewSongOnly: true, // don't re-announce when a song repeats
            savePreviousSongs: true,
            nsfw: true, // private friends' server: allow age-restricted results everywhere
            emitAddSongWhenCreatingQueue: false,
            emitAddListWhenCreatingQueue: false,
            joinNewVoiceChannel: true,
            ffmpeg: {
                path: config.ffmpegPath,
                args: {
                    // The input is our own local relay; never let ffmpeg "reconnect" and replay audio.
                    input: { reconnect: false, reconnect_streamed: false, reconnect_delay_max: false },
                },
            },
        });
        this.distube.setMaxListeners(30);

        /** guildId -> last "Now playing" message, so we can tidy it up */
        this.nowPlayingMessages = new Map();
        /** guildId -> timeout */
        this.aloneTimers = new Map();
        this.idleTimers = new Map();

        this.#registerEvents();
    }

    async start() {
        await this.streamServer.start();
    }

    #registerEvents() {
        const d = this.distube;

        d.on('initQueue', queue => {
            queue.setVolume(config.defaultVolume);
        });

        d.on('playSong', async (queue, song) => {
            this.#clearTimer(this.idleTimers, queue.id);
            await this.ensureUpNext(queue);
            this.#prefetchNext(queue);
            await this.#deleteNowPlaying(queue.id);
            if (!queue.textChannel) return;
            try {
                const msg = await queue.textChannel.send({ embeds: [this.nowPlayingEmbed(queue, song)] });
                this.nowPlayingMessages.set(queue.id, msg);
            } catch (err) {
                console.error('[PLAYER] Could not send now-playing message:', err.message);
            }
        });

        // Keep prefetch pointed at whatever is next if the queue changes.
        d.on('addSong', queue => this.#prefetchNext(queue));
        d.on('addList', queue => this.#prefetchNext(queue));

        d.on('finish', async queue => {
            await this.#deleteNowPlaying(queue.id);
            queue.textChannel?.send({ embeds: [embed('info', '✅ Queue finished. Use `/play` to add more.')] }).catch(() => {});
            this.#startIdleTimer(queue.id);
        });

        d.on('noRelated', async queue => {
            queue.textChannel?.send({ embeds: [embed('info', '♾️ Autoplay couldn\'t find a related song, so the music stopped. Use `/play` or `/radio` to start again.')] }).catch(() => {});
            this.#startIdleTimer(queue.id);
        });

        d.on('disconnect', queue => this.#cleanup(queue.id));
        d.on('deleteQueue', queue => this.#deleteNowPlaying(queue.id));

        d.on('error', (error, queue, song) => {
            console.error(`[PLAYER] Error${song ? ` while playing "${song.name}"` : ''}:`, error.message);
            const where = song ? ` **${truncate(song.name, 80)}**` : '';
            queue?.textChannel?.send({ embeds: [embed('error', `❌ Could not play${where}: ${friendlyError(error)}`)] }).catch(() => {});
        });

        // yt-dlp failed to deliver audio (song would otherwise just silently skip).
        this.streamServer.on('streamError', (songUrl, error) => {
            for (const queue of this.distube.queues.collection.values()) {
                const current = queue.songs[0];
                if (current?.url === songUrl) {
                    queue.textChannel?.send({
                        embeds: [embed('error', `❌ Could not stream **${truncate(current.name, 80)}**: ${friendlyError(error)}`)],
                    }).catch(() => {});
                }
            }
        });

        if (process.env.DEBUG_DISTUBE === 'true') {
            d.on('debug', m => console.debug('[DisTube]', m));
            d.on('ffmpegDebug', m => console.debug('[ffmpeg]', m));
        }
    }

    nowPlayingEmbed(queue, song) {
        const e = new EmbedBuilder()
            .setColor(COLORS.info)
            .setAuthor({ name: 'Now playing' })
            .setTitle(truncate(song.name || 'Unknown title', 250))
            .addFields(
                { name: 'Duration', value: song.isLive ? '🔴 Live' : song.formattedDuration || '?', inline: true },
                { name: 'Requested by', value: song.member ? `${song.member}` : 'Unknown', inline: true },
                { name: 'Up next', value: queue.songs[1] ? truncate(queue.songs[1].name, 100) : 'Nothing', inline: true },
            )
            .setFooter({ text: `Volume ${queue.volume}% • Loop: ${REPEAT_LABEL[queue.repeatMode]} • Autoplay: ${queue.autoplay ? 'On' : 'Off'} • ${queue.songs.length} in queue` });
        if (song.url) e.setURL(song.url);
        if (song.thumbnail) e.setThumbnail(song.thumbnail);
        return e;
    }

    /**
     * With autoplay on, add the next related song as soon as the last queued song
     * starts, so it can be prefetched and there is no silence between songs.
     */
    async ensureUpNext(queue) {
        if (!queue.autoplay || queue.songs.length !== 1 || queue.repeatMode !== RepeatMode.DISABLED) return;
        try {
            await queue.addRelatedSong();
        } catch {
            // DisTube will try again (and emit "noRelated") when the song ends.
        }
    }

    prefetchNext(queue) {
        this.#prefetchNext(queue);
    }

    #prefetchNext(queue) {
        if (queue.repeatMode === RepeatMode.SONG) return;
        const next = queue.songs[1] ?? (queue.repeatMode === RepeatMode.QUEUE ? queue.songs[0] : null);
        if (next?.url && !next.isLive) this.streamServer.prefetch(next.url);
    }

    async #deleteNowPlaying(guildId) {
        const msg = this.nowPlayingMessages.get(guildId);
        this.nowPlayingMessages.delete(guildId);
        if (msg) await msg.delete().catch(() => {});
    }

    #clearTimer(map, guildId) {
        const t = map.get(guildId);
        if (t) clearTimeout(t);
        map.delete(guildId);
    }

    #startIdleTimer(guildId) {
        if (!config.leaveWhenIdleAfter) return;
        this.#clearTimer(this.idleTimers, guildId);
        this.idleTimers.set(guildId, setTimeout(() => {
            this.idleTimers.delete(guildId);
            const queue = this.distube.getQueue(guildId);
            if (queue && queue.songs.length && !queue.stopped) return; // started playing again
            this.distube.voices.leave(guildId);
        }, config.leaveWhenIdleAfter * 1000));
    }

    #cleanup(guildId) {
        this.#clearTimer(this.aloneTimers, guildId);
        this.#clearTimer(this.idleTimers, guildId);
        this.#deleteNowPlaying(guildId);
    }

    /** Called on every voiceStateUpdate: leave when everyone else has left the channel. */
    onVoiceStateUpdate(oldState, newState) {
        const guild = newState.guild ?? oldState.guild;
        const me = guild.members.me;

        // The bot itself was disconnected/moved by someone.
        if (newState.id === me?.id && !newState.channelId) {
            this.#cleanup(guild.id);
            return;
        }

        const channel = me?.voice?.channel;
        if (!channel || !config.leaveWhenAloneAfter) return;
        const humans = channel.members.filter(m => m && !m.user.bot).size;

        if (humans === 0) {
            if (this.aloneTimers.has(guild.id)) return;
            this.aloneTimers.set(guild.id, setTimeout(() => {
                this.aloneTimers.delete(guild.id);
                const ch = guild.members.me?.voice?.channel;
                if (!ch || ch.members.filter(m => m && !m.user.bot).size > 0) return;
                const queue = this.distube.getQueue(guild.id);
                queue?.textChannel?.send({ embeds: [embed('info', '👋 Everyone left, so I left the voice channel too.')] }).catch(() => {});
                this.distube.voices.leave(guild.id);
            }, config.leaveWhenAloneAfter * 1000));
        } else {
            this.#clearTimer(this.aloneTimers, guild.id);
        }
    }
}

PlayerManager.REPEAT_LABEL = REPEAT_LABEL;
module.exports = PlayerManager;
