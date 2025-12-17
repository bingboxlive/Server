const WebSocket = require('ws');
const { rooms, getOrCreateRoom, clientPCs } = require('../state/store');
const { broadcastRoomState } = require('./broadcaster');
const { playNext } = require('../services/playback');
const { reorderQueue } = require('../services/queue');
const { handleJoinStream, handleAnswer, handleCandidate } = require('./webrtc');
const { getRandomName } = require('../utils/nameGenerator');

function setupWebSocketServer(wss) {
    wss.on('connection', ws => {
        ws.isAlive = true;
        ws.on('pong', () => ws.isAlive = true);

        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                switch (data.type) {
                    case 'JOIN_ROOM':
                        const { roomId, userId, userName } = data;
                        if (!roomId) return;

                        if (ws.roomId && rooms.has(ws.roomId)) {
                            const oldRoom = rooms.get(ws.roomId);
                            oldRoom.clients.delete(ws);
                            if (ws.audioSource) oldRoom.activeAudioSources.delete(ws.audioSource);
                        }

                        ws.roomId = roomId;
                        ws.userId = userId;
                        ws.userName = userName || getRandomName();
                        const room = getOrCreateRoom(roomId);
                        room.clients.add(ws);

                        room.lastEmptyTime = null;

                        if (ws.audioSource) {
                            room.activeAudioSources.add(ws.audioSource);
                        }

                        broadcastRoomState(room);
                        break;

                    case 'PAUSE':
                        if (ws.roomId && rooms.has(ws.roomId)) {
                            const r = rooms.get(ws.roomId);
                            if (r.isPlaying && !r.isPaused) {
                                r.isPaused = true;
                                r.pausedAt = Date.now();
                                broadcastRoomState(r);
                            }
                        }
                        break;

                    case 'RESUME':
                        if (ws.roomId && rooms.has(ws.roomId)) {
                            const r = rooms.get(ws.roomId);
                            if (r.isPlaying && r.isPaused) {
                                r.isPaused = false;
                                r.nextAudioTime = Date.now();

                                if (r.pausedAt) {
                                    r.totalPausedDuration += (Date.now() - r.pausedAt);
                                    r.pausedAt = null;
                                }
                                broadcastRoomState(r);
                            }
                        }
                        break;

                    case 'SKIP':
                        if (ws.roomId && rooms.has(ws.roomId)) {
                            const r = rooms.get(ws.roomId);
                            if (r.isPlaying) {
                                console.log(`[Room ${r.id}] Skipping track`);
                                playNext(r);
                            }
                        }
                        break;

                    case 'PREVIOUS':
                        if (ws.roomId && rooms.has(ws.roomId)) {
                            const r = rooms.get(ws.roomId);

                            if (r.isPlaying && r.currentTrack && r.startTime) {
                                const now = Date.now();
                                let effectiveStartTime = r.startTime;
                                if (r.totalPausedDuration) effectiveStartTime += r.totalPausedDuration;

                                let elapsed = 0;
                                if (r.isPaused && r.pausedAt) {
                                    elapsed = r.pausedAt - effectiveStartTime;
                                } else {
                                    elapsed = now - effectiveStartTime;
                                }

                                const elapsedSec = elapsed / 1000;
                                console.log(`[Room ${r.id}] Previous requested. Elapsed: ${elapsedSec}s`);

                                if (elapsedSec > 15) {
                                    const trackToReplay = r.currentTrack;
                                    r.currentTrack = null;
                                    r.queue.unshift(trackToReplay);
                                    playNext(r);
                                } else {
                                    if (r.history.length > 0) {
                                        const prevTrack = r.history.pop();
                                        const current = r.currentTrack;

                                        r.queue.unshift(current);
                                        r.queue.unshift(prevTrack);

                                        r.currentTrack = null;
                                        playNext(r);
                                    } else {
                                        const trackToReplay = r.currentTrack;
                                        r.currentTrack = null;
                                        r.queue.unshift(trackToReplay);
                                        playNext(r);
                                    }
                                }
                            }
                            else if (!r.isPlaying && r.history.length > 0) {
                                console.log(`[Room ${r.id}] Resurrecting from history`);
                                const prevTrack = r.history.pop();
                                r.queue.unshift(prevTrack);
                                playNext(r);
                            }
                        }
                        break;

                    case 'JOIN_STREAM':
                        await handleJoinStream(ws);
                        break;
                    case 'JOIN_STREAM_WS':
                        console.log(`[Room ${ws.roomId}] Client joining via WebSocket Audio`);
                        if (ws.roomId && rooms.has(ws.roomId)) {
                            const r = rooms.get(ws.roomId);
                            r.websocketAudioClients.add(ws);
                            ws.isWsAudio = true;
                        }
                        break;
                    case 'LEAVE_STREAM':
                        if (ws.roomId && rooms.has(ws.roomId)) {
                            const r = rooms.get(ws.roomId);
                            if (ws.isWsAudio) {
                                r.websocketAudioClients.delete(ws);
                                ws.isWsAudio = false;
                            }
                            if (ws.audioSource) {
                                r.activeAudioSources.delete(ws.audioSource);
                                const pc = clientPCs.get(ws);
                                if (pc) pc.close();
                                clientPCs.delete(ws);
                            }
                        }
                        break;
                    case 'ANSWER':
                        await handleAnswer(ws, data.sdp);
                        break;
                    case 'ICE_CANDIDATE':
                        await handleCandidate(ws, data.candidate);
                        break;
                    case 'REMOVE_TRACK':
                        if (ws.roomId && rooms.has(ws.roomId)) {
                            const r = rooms.get(ws.roomId);
                            const idx = r.queue.findIndex(t => t.id === data.trackId);
                            if (idx !== -1) {
                                console.log(`[Room ${r.id}] Removing track ${data.trackId}`);
                                r.queue.splice(idx, 1);
                                reorderQueue(r);
                                broadcastRoomState(r);
                            }
                        }
                        break;
                    case 'TOGGLE_QUEUE_MODE':
                        if (ws.roomId && rooms.has(ws.roomId)) {
                            const r = rooms.get(ws.roomId);
                            if (data.mode === 'classic' || data.mode === 'roundrobin' || data.mode === 'shuffle') {
                                console.log(`[Room ${r.id}] Switching queue mode to ${data.mode}`);
                                r.queueMode = data.mode;
                                reorderQueue(r);
                                broadcastRoomState(r);
                            }
                        }
                        break;
                    default:
                        break;
                }
            } catch (e) {
                console.error('Error handling message:', e);
            }
        });

        ws.on('close', () => {
            if (ws.roomId && rooms.has(ws.roomId)) {
                const room = rooms.get(ws.roomId);
                room.clients.delete(ws);
                if (ws.audioSource) {
                    room.activeAudioSources.delete(ws.audioSource);
                }
                if (ws.isWsAudio) {
                    room.websocketAudioClients.delete(ws);
                }
                broadcastRoomState(room);

                if (room.clients.size === 0) {
                    room.lastEmptyTime = Date.now();
                    console.log(`[Room ${room.id}] is now empty. Scheduled for deletion in 5 mins.`);
                }
            }
        });
    });

    const interval = setInterval(function ping() {
        wss.clients.forEach(function each(ws) {
            if (ws.isAlive === false) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);

    wss.on('close', function close() {
        clearInterval(interval);
    });
}

module.exports = { setupWebSocketServer };
