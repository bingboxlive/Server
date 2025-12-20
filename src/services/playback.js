const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { broadcastRoomState } = require('../socket/broadcaster');
const { getVideoInfo } = require('./downloader');
const { formatDuration } = require('../utils/helpers');

async function playNext(room) {
    const myRequestId = Date.now() + Math.random();
    room.currentPlayRequestId = myRequestId;

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

    console.log(`[Room ${room.id}] Starting track: ${track.title} (ReqID: ${myRequestId})`);

    if (!track.durationSec || track.durationSec === 0 || track.isSpotifySearch) {
        try {
            console.log(`[Room ${room.id}] Resolving real duration for: ${track.title}`);
            const info = await getVideoInfo(track.url, 10);

            if (room.currentPlayRequestId !== myRequestId) {
                console.log(`[Room ${room.id}] Play request ${myRequestId} preempted during metadata resolve. Aborting.`);
                return;
            }

            let realUrl = info.webpage_url || info.url || track.url;
            let duration = info.duration;
            let durationString = info.duration_string;

            if (info.entries && info.entries.length > 0) {
                const entry = info.entries[0];
                realUrl = entry.webpage_url || entry.url || realUrl;
                duration = entry.duration;
                durationString = entry.duration_string;
            }

            if (info.webpage_url && (!realUrl || realUrl.includes('googlevideo.com'))) {
                realUrl = info.webpage_url;
            }

            track.url = realUrl;
            if (duration) {
                track.durationSec = duration;
                track.duration = durationString || formatDuration(duration);
            }

            console.log(`[Room ${room.id}] Resolved duration: ${track.duration} (${track.durationSec}s)`);
            broadcastRoomState(room);

        } catch (e) {
            console.error(`[Room ${room.id}] Failed to resolve metadata:`, e.message);
        }
    }

    if (room.currentPlayRequestId !== myRequestId) {
        console.log(`[Room ${room.id}] Play request ${myRequestId} preempted. Aborting.`);
        return;
    }

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

    const downloadQueue = require('./download_queue');

    const tmpDir = path.join(os.tmpdir(), 'bingbox', `${room.id}_${myRequestId}`);
    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    const cookiePath = path.resolve('cookies.txt');

    const ytDlpArgs = ['--cookies', cookiePath, '--js-runtimes', 'node', '-f', 'bestaudio/best', '-o', '-', track.url];

    const newProcess = await downloadQueue.add(track.url, 'stream', ytDlpArgs, 10, { cwd: tmpDir });

    if (room.currentPlayRequestId !== myRequestId) {
        console.log(`[Room ${room.id}] Play request ${myRequestId} preempted after download queue. Killing ghost process.`);
        if (newProcess && newProcess.kill) {
            newProcess.kill();
        }
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (e) {
            console.error(`[Room ${room.id}] Failed to cleanup aborted temp dir:`, e.message);
        }
        return;
    }

    room.ytDlpProcess = newProcess;

    room.ytDlpProcess.stdout.on('error', (e) => {
        if (e.code !== 'EPIPE') {
            console.error(`[Room ${room.id}] yt-dlp stdout error:`, e);
        }
    });

    room.ytDlpProcess.stderr.on('data', (d) => {
        console.error(`[Room ${room.id}] yt-dlp stderr: ${d.toString()}`);
    });

    room.ytDlpProcess.on('close', (code) => {
        console.log(`[Room ${room.id}] yt-dlp exited with code ${code}`);
        try {
            if (fs.existsSync(tmpDir)) {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        } catch (cleanupErr) {
            console.error(`[Room ${room.id}] Failed to cleanup temp dir:`, cleanupErr);
        }
    });

    const ffmpegArgs = [
        '-i', 'pipe:0',
        '-f', 's16le',
        '-ac', '1',
        '-ar', '48000',
        'pipe:1'
    ];

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);
    room.ffmpegProcess = ffmpegProcess;

    ffmpegProcess.stdin.on('error', (e) => {
        if (e.code !== 'EPIPE') {
            console.error(`[Room ${room.id}] ffmpeg stdin error:`, e);
        }
    });

    if (room.ytDlpProcess) {
        room.ytDlpProcess.stdout.pipe(ffmpegProcess.stdin);
    }

    ffmpegProcess.stderr.on('data', d => {
    });

    const CHUNK_SIZE = 960;
    const WS_CHUNK_SIZE = 4096;

    ffmpegProcess.stdout.on('data', chunk => {
        if (room.ffmpegProcess !== ffmpegProcess) return;

        room.audioBuffer = Buffer.concat([room.audioBuffer, chunk]);

        if (room.audioBuffer.length > room.BUFFER_HIGH_WATER_MARK) {
            ffmpegProcess.stdout.pause();
        }
    });

    room.nextAudioTime = Date.now();
    startPlaybackLoop(room, CHUNK_SIZE);

    ffmpegProcess.on('close', (code) => {
        if (room.ffmpegProcess !== ffmpegProcess) return;
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

            const playedDuration = room.startTime ? (Date.now() - room.startTime) : 0;
            if (playedDuration < 2000) {
                console.log(`[Room ${room.id}] Track ended too quickly (${playedDuration}ms). Delaying next track by 1000ms.`);
                setTimeout(() => playNext(room), 1000);
            } else {
                playNext(room);
            }
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
