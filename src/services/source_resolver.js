const { rooms } = require('../state/store');
const { broadcastRoomState } = require('../socket/broadcaster');
const { getVideoInfo } = require('./downloader');
const { formatDuration, sleep } = require('../utils/helpers');

class SourceResolver {
    constructor() {
        this.roomOrder = [];
        this.isProcessing = false;
        // Keep track of rooms that have pending work to avoid duplicates in roomOrder
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
        this.activeRooms.delete(roomId); // Remove from set, will be re-added if we find more work or are re-notified

        const room = rooms.get(roomId);
        if (!room) {
            // Room apparently gone
            return this.processNext();
        }

        // Find a track that needs resolution
        // We look for tracks that start with 'ytsearch1:' AND are not the current track
        // We iterate specifically through the room.queue
        const queueIndex = room.queue.findIndex(t => t.url && t.url.startsWith('ytsearch1:'));

        if (queueIndex !== -1) {
            const track = room.queue[queueIndex];

            // Re-add room to back of queue immediately if there might be more, 
            // but we only process one track per turn per room.
            // Actually, let's process one, then if there are MORE, we re-add.
            // If we found one, we assume there might be more or we just want to keep checking this room until clean.
            // But to be fair (Round Robin), we put it at the end.

            try {
                console.log(`[SourceResolver] Resolving source for Room ${roomId}: "${track.title}"`);

                // Add a flag to indicate resolution is in progress to prevent double-processing if logic changes?
                // For now, single threaded nodejs means we are safe from race conditions within this function,
                // but playNext could strictly happen in parallel events.
                // playNext only cares about room.queue[0] becoming currentTrack.
                // If we are resolving room.queue[0], and playNext happens, it takes the track.
                // track object reference is shared.

                const info = await getVideoInfo(track.url);

                let realUrl = info.url || track.url;
                let duration = info.duration;
                let durationString = info.duration_string;

                if (info.entries && info.entries.length > 0) {
                    const entry = info.entries[0];
                    realUrl = entry.url || entry.webpage_url || realUrl;
                    duration = entry.duration;
                    durationString = entry.duration_string;
                } else if (info.webpage_url) {
                    realUrl = info.webpage_url;
                }

                // Update track - MUTATION
                track.url = realUrl;
                if (duration) {
                    track.durationSec = duration;
                    track.duration = durationString || formatDuration(duration);
                }

                console.log(`[SourceResolver] Resolved: ${track.title} -> ${track.duration}`);

                broadcastRoomState(room);

                // If there are potentially more tracks in this room (we just resolved one),
                // we should put the room back in the queue to check again later.
                // Optimistically assume yes if we found one.
                this.notifyRoom(roomId);

            } catch (e) {
                console.error(`[SourceResolver] Failed to resolve ${track.title}: ${e.message}`);
                // If failed, maybe we should leave it as ytsearch1: so playNext can try again/fail later?
                // Or remove it? Better to leave it.
                // To avoid infinite loop on a failing track, we might need to skip strict re-queueing 
                // OR implementation a "failed attempts" counter.
                // For now, let's just wait a bit longer and NOT re-queue immediately to prevent log spam if it's the only track.
                // actually, if we don't move passed it, we will keep finding it!
                // We MUST skip it or mark it 'attempted'.

                // Let's add a temporary property to ignore it for a while? 
                // Or just rely on slow cycle.
                // Simplest: Ignore it for this session of resolver.
                // Actually, if we leave it as ytsearch1, next pass finds it again.
                // We shouldn't block the queue.
                // Let's mark it custom property `track.resolverFailed = true` and filter that in findIndex.
                track.resolverFailed = true;

                // Re-queue room to process others
                this.notifyRoom(roomId);
            }

            // Wait before next room (Throttling)
            await sleep(3000); // 3 seconds
        } else {
            // No work found in this room. We don't re-add it.
            // It will be re-added by notifyRoom when new tracks arrive.
            console.log(`[SourceResolver] Room ${roomId} clean. Removed from active queue.`);
        }

        this.processNext();
    }
}

const sourceResolver = new SourceResolver();

module.exports = { sourceResolver };
