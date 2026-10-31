# Discord Music Bot (self-hosted, for friends)

A private Discord music bot for your own server. It plays music from YouTube, YouTube Music, SoundCloud, Bandcamp, Vimeo, Twitch, Mixcloud, Audiomack, Deezer and Dailymotion through **yt-dlp**, and from Spotify track links (matched on YouTube). Everything is driven by slash commands. Links to other sites are rejected so users can't make the server fetch arbitrary URLs; add more domains with `EXTRA_ALLOWED_HOSTS`.

**📄 Full step-by-step guide (PDF): [`docs/Music-Bot-Setup-Guide.pdf`](docs/Music-Bot-Setup-Guide.pdf)**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/muhammad-propfirms/discord-music-bot)

## Commands

| Command | What it does |
|---|---|
| `/play query [next]` | Play by song title or any text (best YouTube match), a link, or a playlist link. With `next:true` it goes to the front of the queue |
| `/search query` | Show 5 YouTube results and pick one with buttons |
| `/radio query [songs]` | Type a song, artist or mood (e.g. `90s rock`). Plays the best match plus related songs, then keeps going |
| `/autoplay [mode]` | Keep playing related songs when the queue runs out |
| `/pause` `/resume` | Pause or resume |
| `/skip` `/previous` | Next or previous song |
| `/jump position` | Skip ahead to song # from `/queue` |
| `/remove position` | Remove song # from the queue |
| `/queue [page]` | Show the queue |
| `/nowplaying` | Current song with a progress bar |
| `/loop mode` | Off, this song, or the whole queue |
| `/shuffle` | Shuffle upcoming songs |
| `/seek time` | Jump to `1:30` or `90` |
| `/volume [percent]` | Show or set the volume (0–150) |
| `/stop` | Stop, clear the queue and leave |
| `/leave` | Leave the voice channel |
| `/help` `/info` | List of commands, and bot status |

The bot leaves on its own when everyone has left the channel (after 60 s) or when the queue has finished (after 5 min).

## Quick start (your own PC)

Requirements: **Node.js 22.12 or newer** (24 LTS recommended).

```bash
git clone https://github.com/muhammad-propfirms/discord-music-bot.git
cd discord-music-bot
npm install
cp .env.example .env      # on Windows: copy .env.example .env
# put your bot token in .env  (TOKEN=...)
npm run check             # self-test: ffmpeg, yt-dlp, YouTube playback, token
npm start
```

You don't install ffmpeg or yt-dlp yourself. ffmpeg comes bundled through `ffmpeg-static`, and the right yt-dlp build is downloaded to `./bin` on first start. yt-dlp then updates itself on every start.

## Deploy on Render

This repo includes a [`render.yaml`](render.yaml) Blueprint. In Render, choose **New → Blueprint** and pick this repo. Render then creates the service, sets the build and start commands and the health check, and asks you for `TOKEN` (required) plus `GUILD_ID` and `ALLOWED_ROLE_IDS` (both optional). The PDF guide covers this in detail, along with keeping a free instance awake and adding YouTube cookies if Render's IP gets blocked.

## Settings (`.env`)

See [`.env.example`](.env.example). The main ones:

| Variable | Required | Meaning |
|---|---|---|
| `TOKEN` | ✅ | Bot token from the Discord Developer Portal |
| `GUILD_ID` | | Your server ID(s), comma-separated. Empty means every server the bot is in |
| `ALLOWED_USER_IDS` / `ALLOWED_ROLE_IDS` | | Limit who can use the bot. Empty means everyone |
| `DEFAULT_VOLUME` | | Starting volume, 0–100 (default 50) |
| `YTDLP_COOKIES` / `YTDLP_COOKIES_BASE64` | | YouTube cookies, only needed if YouTube says *"confirm you're not a bot"* |

## What was fixed (vs. the original repo)

- **No sound / voice errors.** Discord now requires DAVE end-to-end voice encryption and newer encryption modes. Upgraded `@discordjs/voice` from 0.17 to 0.19, which brings `@snazzah/davey`.
- **YouTube 403 errors.** YouTube now rejects ffmpeg fetching its media URLs directly. Audio is now downloaded by yt-dlp and passed to ffmpeg through a local relay (bound to 127.0.0.1 only). The next song is prefetched so there's almost no gap between songs.
- **yt-dlp needs a JavaScript runtime** for YouTube. Node.js is now passed to it automatically.
- **Wrong yt-dlp build on Linux.** The old plugin downloaded a build that needs Python. Now the correct standalone build is downloaded for each OS and CPU.
- **ffmpeg was never wired up.** DisTube v5 needs an explicit path. The bundled `ffmpeg-static` is now used.
- **Privileged intent removed.** `GuildMembers` made login fail unless it was turned on in the portal, and it isn't needed.
- **Crashes from double replies.** Fixed in `/queue` and in the global error handler, and replies are now deferred properly.
- Playlists, Spotify tracks, loop, now-playing, remove and leave are now supported, and the "free tier" limits are gone.
- **Leaked YouTube session cookies removed** from the source code and from git history.
- Down from 25+ unused dependencies to 9.

## Credits

Based on the DisTube music bot by GlaceYT, via [MIANHANZALA/Real-World-Music-Bot-2](https://github.com/MIANHANZALA/Real-World-Music-Bot-2). Powered by [discord.js](https://discord.js.org), [DisTube](https://distube.js.org) and [yt-dlp](https://github.com/yt-dlp/yt-dlp).
