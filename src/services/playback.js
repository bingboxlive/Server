const WebSocket = require('ws');
const { spawn } = require('child_process');
const { broadcastRoomState } = require('../socket/broadcaster');

function playNext(room) {
    if (room.currentTrack) {
        room.history.push(room.currentTrack);
        if (room.history.length > 50) room.history.shift();
    }

    if (room.playbackInterval) {
        clearInterval(room.playbackInterval);
        room.playbackInterval = null;
    }
    room.audioBuffer = Buffer.alloc(0);
    room.ffmpegFinished = false;

    if (room.queue.length === 0) {
        room.isPlaying = false;
        room.isPaused = false;
        room.currentTrack = null;
        room.startTime = null;
        room.totalPausedDuration = 0;

        if (room.ffmpegProcess) {
            room.manualSkip = true;
            room.ffmpegProcess.kill();
            room.ffmpegProcess = null;
        }
        if (room.ytDlpProcess) {
            room.ytDlpProcess.kill();
            room.ytDlpProcess = null;
        }

        broadcastRoomState(room);
        return;
    }

    const track = room.queue.shift();
    room.currentTrack = track;
    room.isPlaying = true;
    room.isPaused = false;
    room.pausedAt = null;
    room.totalPausedDuration = 0;
    room.startTime = null;
    broadcastRoomState(room);

    console.log(`[Room ${room.id}] Starting track: ${track.title}`);

    if (room.ffmpegProcess) {
        room.ffmpegProcess.removeAllListeners('close');
        room.ffmpegProcess.kill();
        room.ffmpegProcess = null;
    }
    if (room.ytDlpProcess) {
        if (room.ytDlpProcess.exitCode === null) {
            room.ytDlpProcess.kill();
        }
        room.ytDlpProcess = null;
    }

    const ytDlpArgs = ['--cookies', 'cookies.txt', '--js-runtimes', 'node', '-f', 'bestaudio', '-o', '-', track.url];
    room.ytDlpProcess = spawn('yt-dlp', ytDlpArgs);

    room.ytDlpProcess.stdout.on('error', (e) => {
        if (e.code !== 'EPIPE') {
            console.error(`[Room ${room.id}] yt-dlp stdout error:`, e);
        }
    });

    room.ytDlpProcess.on('close', (code) => {
        console.log(`[Room ${room.id}] yt-dlp exited with code ${code}`);
    });

    const ffmpegArgs = [
        '-i', 'pipe:0',
        '-f', 's16le',
        '-ac', '1',
        '-ar', '48000',
        'pipe:1'
    ];

    room.ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    room.ffmpegProcess.stdin.on('error', (e) => {
        if (e.code !== 'EPIPE') {
            console.error(`[Room ${room.id}] ffmpeg stdin error:`, e);
        }
    });

    room.ytDlpProcess.stdout.pipe(room.ffmpegProcess.stdin);

    room.ffmpegProcess.stderr.on('data', d => {
    });

    const CHUNK_SIZE = 960;
    const WS_CHUNK_SIZE = 4096;

    room.ffmpegProcess.stdout.on('data', chunk => {
        room.audioBuffer = Buffer.concat([room.audioBuffer, chunk]);

        if (room.audioBuffer.length > room.BUFFER_HIGH_WATER_MARK) {
            room.ffmpegProcess.stdout.pause();
        }
    });

    room.nextAudioTime = Date.now();
    startPlaybackLoop(room, CHUNK_SIZE);

    room.ffmpegProcess.on('close', (code) => {
        console.log(`[Room ${room.id}] Ffmpeg process finished. Waiting for buffer drain.`);
        room.ffmpegFinished = true;
    });
}

function startPlaybackLoop(room, CHUNK_SIZE) {
    if (room.playbackInterval) clearInterval(room.playbackInterval);

    let tickCount = 0;
    const CHUNK_DURATION_MS = 10;
    room.wsAccumulator = Buffer.alloc(0);
    const WS_CHUNK_SIZE = 4096;

    room.playbackInterval = setInterval(() => {
        if (room.isPaused) return;

        if (room.ffmpegFinished && room.audioBuffer.length < CHUNK_SIZE) {
            console.log(`[Room ${room.id}] Buffer drained (remaining: ${room.audioBuffer.length}). Playing next.`);

            if (room.wsAccumulator.length > 0 && room.websocketAudioClients.size > 0) {
                const payload = room.wsAccumulator;
                room.websocketAudioClients.forEach(ws => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
                });
            }
            room.wsAccumulator = Buffer.alloc(0);

            clearInterval(room.playbackInterval);
            room.playbackInterval = null;
            playNext(room);
            return;
        }

        const now = Date.now();
        tickCount++;



        if (now - room.nextAudioTime > 1000) {
            room.nextAudioTime = now;
        }

        const maxChunks = (tickCount % 2 === 0) ? 1 : 2;
        let chunksSent = 0;

        while (now >= room.nextAudioTime && room.audioBuffer.length >= CHUNK_SIZE && chunksSent < maxChunks) {

            if (room.startTime === null) {
                console.log(`[Room ${room.id}] First chunk sent. Starting timer.`);
                room.startTime = Date.now();
                room.nextAudioTime = room.startTime;
                broadcastRoomState(room);
            }

            const bufferSegment = room.audioBuffer.subarray(0, CHUNK_SIZE);
            const samples = new Int16Array(
                bufferSegment.buffer.slice(bufferSegment.byteOffset, bufferSegment.byteOffset + CHUNK_SIZE)
            );

            for (const source of room.activeAudioSources) {
                try {
                    source.onData({
                        samples,
                        sampleRate: 48000
                    });
                } catch (e) {
                    console.error('Error feeding audio source:', e.message);
                }
            }

            if (room.websocketAudioClients.size > 0) {
                room.wsAccumulator = Buffer.concat([room.wsAccumulator, bufferSegment]);

                if (room.wsAccumulator.length >= WS_CHUNK_SIZE) {
                    const payload = room.wsAccumulator.subarray(0, WS_CHUNK_SIZE);
                    room.websocketAudioClients.forEach(ws => {
                        if (ws.readyState === WebSocket.OPEN) {
                            try {
                                ws.send(payload);
                            } catch (e) {
                            }
                        }
                    });
                    room.wsAccumulator = room.wsAccumulator.subarray(WS_CHUNK_SIZE);
                }
            } else {
                if (room.wsAccumulator.length > 0) room.wsAccumulator = Buffer.alloc(0);
            }

            room.audioBuffer = room.audioBuffer.subarray(CHUNK_SIZE);
            room.nextAudioTime += CHUNK_DURATION_MS;

            chunksSent++;

            if (room.ffmpegProcess && room.ffmpegProcess.stdout.isPaused() && room.audioBuffer.length < room.BUFFER_LOW_WATER_MARK) {
                room.ffmpegProcess.stdout.resume();
            }
        }
    }, 10);
}

module.exports = {
    playNext,
    startPlaybackLoop
};
