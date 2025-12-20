require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { rooms } = require('./state/store');
const { setupWebSocketServer } = require('./socket/index');
const routes = require('./routes/index');
const { metadataScheduler } = require('./services/metadata');
const { sourceResolver } = require('./services/source_resolver');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/', routes);
app.use(express.static(path.join(__dirname, '../public')));

setupWebSocketServer(wss);

setInterval(() => {
    const NOW = Date.now();
    const TIMEOUT = 5 * 60 * 1000;

    rooms.forEach((room, roomId) => {
        if (room.lastEmptyTime && (NOW - room.lastEmptyTime > TIMEOUT)) {
            console.log(`[Cleanup] Deleting empty room: ${roomId}`);

            if (room.ffmpegProcess) {
                room.ffmpegProcess.removeAllListeners('close');
                room.ffmpegProcess.kill();
            }
            if (room.ytDlpProcess) {
                if (room.ytDlpProcess.exitCode === null) room.ytDlpProcess.kill();
            }
            if (room.playbackInterval) {
                clearInterval(room.playbackInterval);
            }

            if (metadataScheduler.roomQueues.has(roomId)) {
                metadataScheduler.roomQueues.delete(roomId);
            }

            // Cleanup SourceResolver
            if (sourceResolver && sourceResolver.activeRooms.has(roomId)) {
                sourceResolver.activeRooms.delete(roomId);
            }

            rooms.delete(roomId);
        }
    });
}, 60000);

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
