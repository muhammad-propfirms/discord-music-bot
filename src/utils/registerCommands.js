'use strict';

/**
 * Register slash commands in one server. Server ("guild") commands show up
 * instantly, unlike global commands which can take up to an hour.
 */
async function registerCommands(client, guildId) {
    const body = [...client.commands.values()].map(c => c.data.toJSON());
    try {
        const registered = await client.application.commands.set(body, guildId);
        const guild = client.guilds.cache.get(guildId);
        console.log(`[COMMANDS] Registered ${registered.size} slash commands in "${guild?.name ?? guildId}".`);
    } catch (error) {
        if (error.code === 50001) {
            console.error(`[COMMANDS] Missing access to server ${guildId}. Is the bot in that server, and was it invited with the "applications.commands" scope?`);
        } else {
            console.error(`[COMMANDS] Failed to register commands in ${guildId}:`, error.message);
        }
    }
}

module.exports = { registerCommands };
