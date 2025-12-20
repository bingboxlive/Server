const { rooms } = require('../state/store');
const { broadcastRoomState } = require('../socket/broadcaster');
const { getVideoInfo } = require('./downloader');
const { formatDuration, sleep } = require('../utils/helpers');

class SourceResolver {
    constructor() {
        this.roomOrder = [];
        this.isProcessing = false;
        this.activeRooms = new Set();
    }

    notifyRoom(roomId) {
        if (!this.activeRooms.has(roomId)) {
            this.activeRooms.add(roomId);
            this.roomOrder.push(roomId);
            console.log(`[SourceResolver] Room ${roomId} added to resolution queue.`);
            this.start();
        }
    }

    start() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        this.processNext();
    }

    async processNext() {
        if (this.roomOrder.length === 0) {
            this.isProcessing = false;
            console.log('[SourceResolver] No more rooms to process. Sleeping.');
            return;
        }

        const roomId = this.roomOrder.shift();
        this.activeRooms.delete(roomId);

        const room = rooms.get(roomId);
        if (!room) {
            return this.processNext();
        }

        const queueIndex = room.queue.findIndex(t => t.url && t.url.startsWith('ytsearch1:'));

        if (queueIndex !== -1) {
            const track = room.queue[queueIndex];

            try {
                console.log(`[SourceResolver] Resolving source for Room ${roomId}: "${track.title}"`);

                const info = await getVideoInfo(track.url);

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

                console.log(`[SourceResolver] Resolved: ${track.title} -> ${track.duration}`);

                broadcastRoomState(room);

                this.notifyRoom(roomId);

            } catch (e) {
                console.error(`[SourceResolver] Failed to resolve ${track.title}: ${e.message}`);
                track.resolverFailed = true;

                this.notifyRoom(roomId);
            }

            await sleep(3000);
        } else {
            console.log(`[SourceResolver] Room ${roomId} clean. Removed from active queue.`);
        }

        this.processNext();
    }
}

const sourceResolver = new SourceResolver();

module.exports = { sourceResolver };
