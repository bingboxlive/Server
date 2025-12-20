const WebSocket = require('ws');

function broadcastRoomState(room) {
    const clientList = Array.from(room.clients).map(c => ({
        userId: c.userId,
        userName: c.userName
    }));

    const state = JSON.stringify({
        type: 'UPDATE',
        queue: room.queue,
        queueMode: room.queueMode,
        currentTrack: room.currentTrack,
        isPlaying: room.isPlaying,
        isPaused: room.isPaused,
        startedAt: room.startTime,
        totalPausedDuration: room.totalPausedDuration,
        serverTime: Date.now(),
        clients: clientList
    });
    room.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(state);
        }
    });
}

module.exports = {
    broadcastRoomState
};
