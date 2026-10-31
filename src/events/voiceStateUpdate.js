'use strict';

module.exports = {
    name: 'voiceStateUpdate',
    execute(oldState, newState, client) {
        client.player.onVoiceStateUpdate(oldState, newState);
    },
};
