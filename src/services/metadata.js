const { rooms } = require('../state/store');
const { broadcastRoomState } = require('../socket/broadcaster');
const { sleep, cleanTitleString, calculateSimilarity } = require('../utils/helpers');

async function fetchCoverArt(releases) {
    if (!releases || releases.length === 0) return null;

    const candidates = releases.slice(0, 3);

    for (const release of candidates) {
        try {
            if (!release.id) continue;
            const url = `https://coverartarchive.org/release/${release.id}`;
            const res = await fetch(url);

            if (res.ok) {
                const data = await res.json();
                if (data.images && data.images.length > 0) {
                    const front = data.images.find(img => img.front) || data.images[0];
                    return front.image.replace(/^http:\/\//i, 'https://');
                }
            }
        } catch (e) {
        }
    }
    return null;
}

function getMusicBrainzMetadata(rawTitle) {
    return new Promise(async (resolve) => {
        const performSearch = async (attempt = 1) => {
            try {
                if (attempt === 1) console.log(`[MusicBrainz] Raw Title: ${rawTitle}`);

                let query = rawTitle;
                const parts = rawTitle.split(' - ');

                if (parts.length >= 2) {
                    const artist = parts[0].trim();
                    let params = parts.slice(1).join(' - ').trim();

                    const isRemix = /remix|mix|edit/i.test(params);

                    const ftMatches = params.match(/(?:ft\.|feat\.|featuring)\s+(.*?)(?:\)|\]|$)/i);
                    let featArtists = [];
                    if (ftMatches && ftMatches[1]) {
                        featArtists = ftMatches[1].split(/,|&/).map(s => s.trim()).filter(s => s.length > 0);
                    }

                    const cleanTitle = cleanTitleString(params);

                    query = `artist:"${artist}" AND recording:"${cleanTitle}"`;

                    if (featArtists.length > 0) {
                        featArtists.forEach(fa => {
                            query += ` AND "${fa}"`;
                        });
                    }

                    if (isRemix) {
                    } else {
                        query += ` AND NOT recording:"remix"`;
                    }
                }

                if (attempt === 1) console.log(`[MusicBrainz] Searching Query: ${query}`);

                const response = await fetch(`https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json`, {
                    headers: {
                        'User-Agent': 'BingBox/1.0 ( your@email.com )'
                    }
                });

                if (!response.ok) {
                    console.error(`[MusicBrainz] API Error (Attempt ${attempt}): ${response.status}`);
                    if (response.status === 503 && attempt < 3) {
                        await sleep(1500);
                        return performSearch(attempt + 1);
                    }
                    return resolve(null);
                }

                const data = await response.json();
                if (data.recordings && data.recordings.length > 0) {
                    const match = data.recordings[0];

                    let artistName = 'Unknown Artist';
                    if (match['artist-credit'] && match['artist-credit'].length > 0) {
                        artistName = match['artist-credit'].map(c => c.name).join(', ');
                    }

                    const cleanRaw = cleanTitleString(rawTitle).toLowerCase();
                    const matchTitle = match.title;
                    const matchArtist = artistName;

                    const candidate1 = cleanTitleString(`${matchArtist} - ${matchTitle}`).toLowerCase();
                    const candidate2 = cleanTitleString(matchTitle).toLowerCase();

                    const sim1 = calculateSimilarity(cleanRaw, candidate1);
                    const sim2 = calculateSimilarity(cleanRaw, candidate2);
                    const bestSim = Math.max(sim1, sim2);

                    console.log(`[MusicBrainz] Match: "${matchArtist} - ${matchTitle}"`);
                    console.log(`[MusicBrainz] Similarity: ${bestSim.toFixed(2)} vs Raw: "${cleanRaw}"`);

                    if (bestSim < 0.75) {
                        console.log('[MusicBrainz] Similarity too low. Ignoring match.');
                        resolve(null);
                        return;
                    }

                    let coverArtUrl = null;
                    if (match.releases) {
                        console.log(`[MusicBrainz] Found ${match.releases.length} releases. Checking cover art...`);
                        coverArtUrl = await fetchCoverArt(match.releases);
                    }

                    resolve({
                        title: match.title,
                        artist: artistName,
                        coverArt: coverArtUrl
                    });
                } else {
                    console.log('[MusicBrainz] No matches found.');
                    resolve(null);
                }
            } catch (e) {
                console.error(`[MusicBrainz] Request failed (Attempt ${attempt}):`, e.message);
                if (attempt < 3) {
                    await sleep(1500);
                    return performSearch(attempt + 1);
                }
                resolve(null);
            }
        };

        await performSearch();
    });
}

class MetadataScheduler {
    constructor() {
        this.roomQueues = new Map();
        this.roomOrder = [];
        this.isProcessing = false;
    }

    enqueue(roomId, tracks) {
        if (!this.roomQueues.has(roomId)) {
            this.roomQueues.set(roomId, []);
            this.roomOrder.push(roomId);
        }
        this.roomQueues.get(roomId).push(...tracks);

        console.log(`[Scheduler] Queued ${tracks.length} tracks for Room ${roomId}. Total Pending: ${this.getTotalPending()}`);

        if (!this.isProcessing) {
            this.start();
        }
    }

    getTotalPending() {
        let count = 0;
        for (const q of this.roomQueues.values()) count += q.length;
        return count;
    }

    start() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        this.processNext();
    }

    async processNext() {
        if (this.roomOrder.length === 0) {
            this.isProcessing = false;
            console.log('[Scheduler] All queues empty. Sleeping.');
            return;
        }

        const roomId = this.roomOrder.shift();
        const queue = this.roomQueues.get(roomId);

        if (!queue || queue.length === 0) {
            this.roomQueues.delete(roomId);
            return this.processNext();
        }

        const track = queue.shift();

        if (queue.length > 0) {
            this.roomOrder.push(roomId);
        } else {
            this.roomOrder.push(roomId);
        }

        try {
            console.log(`[Scheduler] Processing track for Room ${roomId}: ${track.title}`);
            const metadata = await getMusicBrainzMetadata(track.title);

            if (metadata) {
                track.cleanTitle = metadata.title;
                track.artist = metadata.artist;
                if (metadata.coverArt) {
                    track.thumbnail = metadata.coverArt;
                }

                const room = rooms.get(roomId);
                if (room) {
                    broadcastRoomState(room);
                }
            }
        } catch (e) {
            console.error(`[Scheduler] Error processing ${track.title}:`, e.message);
        }

        setTimeout(() => this.processNext(), 1500);
    }
}

const metadataScheduler = new MetadataScheduler();

module.exports = {
    getMusicBrainzMetadata,
    metadataScheduler
};
