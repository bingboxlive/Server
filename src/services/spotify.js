const axios = require('axios');
const { rooms } = require('../state/store');
const { broadcastRoomState } = require('../socket/broadcaster');
const { sleep } = require('../utils/helpers');
const { playNext } = require('./playback');
const { reorderQueue } = require('./queue');

class SpotifyClient {
    constructor() {
        this.clientId = process.env.SPOTIFY_CLIENT_ID;
        this.clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
        this.accessToken = null;
        this.tokenExpiresAt = 0;
    }

    async getToken() {
        if (this.accessToken && Date.now() < this.tokenExpiresAt) {
            return this.accessToken;
        }

        if (!this.clientId || !this.clientSecret) {
            console.error('[Spotify] Missing credentials.');
            return null;
        }

        try {
            const params = new URLSearchParams();
            params.append('grant_type', 'client_credentials');

            const authWrapper = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

            const res = await axios.post('https://accounts.spotify.com/api/token', params, {
                headers: {
                    'Authorization': `Basic ${authWrapper}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            this.accessToken = res.data.access_token;
            this.tokenExpiresAt = Date.now() + (res.data.expires_in * 1000) - 60000; // buffer 1 min
            console.log('[Spotify] New access token acquired.');
            return this.accessToken;
        } catch (e) {
            console.error('[Spotify] Token fetch failed:', e.message);
            return null;
        }
    }

    async getTrack(trackId) {
        const token = await this.getToken();
        if (!token) throw new Error('No Spotify token');

        try {
            const res = await axios.get(`https://api.spotify.com/v1/tracks/${trackId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return res.data;
        } catch (e) {
            console.error('[Spotify] getTrack failed:', e.message);
            return null;
        }
    }

    async getPlaylistTracks(playlistId, offset = 0, limit = 50) {
        const token = await this.getToken();
        if (!token) throw new Error('No Spotify token');

        try {
            const res = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
                headers: { 'Authorization': `Bearer ${token}` },
                params: { offset, limit }
            });
            return res.data; // { items: [], next: 'url' }
        } catch (e) {
            console.error('[Spotify] getPlaylistTracks failed:', e.message);
            return null;
        }
    }
}

class SpotifyScheduler {
    constructor(client) {
        this.client = client;
        this.jobs = new Map(); // roomId -> [{ playlistId, offset, total, userName }]
        this.roomOrder = [];
        this.isProcessing = false;
        this.BATCH_SIZE = 50;
    }

    enqueuePlaylist(roomId, playlistId, userName) {
        if (!this.jobs.has(roomId)) {
            this.jobs.set(roomId, []);
            this.roomOrder.push(roomId);
        }

        this.jobs.get(roomId).push({
            playlistId,
            offset: 0,
            userName
        });

        console.log(`[Spotify] Playlist ${playlistId} queued for Room ${roomId}`);
        this.start();
    }

    start() {
        if (this.isProcessing) return;
        this.isProcessing = true;
        this.processNext();
    }

    async processNext() {
        if (this.roomOrder.length === 0) {
            this.isProcessing = false;
            console.log('[Spotify] Import queue empty.');
            return;
        }

        const roomId = this.roomOrder.shift();
        const roomJobs = this.jobs.get(roomId);

        if (!roomJobs || roomJobs.length === 0) {
            this.jobs.delete(roomId);
            // Dont re-push roomId
            return this.processNext();
        }

        const job = roomJobs[0]; // Peek
        const room = rooms.get(roomId);

        if (!room) {
            console.log(`[Spotify] Room ${roomId} not found. Dropping job.`);
            roomJobs.shift();
            return this.processNext();
        }

        try {
            console.log(`[Spotify] Processing batch for Room ${roomId} (Offset: ${job.offset})`);
            const data = await this.client.getPlaylistTracks(job.playlistId, job.offset, this.BATCH_SIZE);

            if (data && data.items && data.items.length > 0) {
                const newTracks = [];

                data.items.forEach(item => {
                    const track = item.track;
                    if (!track || !track.id) return;

                    const artist = track.artists.map(a => a.name).join(', ');
                    const title = track.name;
                    const query = `ytsearch1:${artist} - ${title}`;

                    let thumbnail = null;
                    if (track.album && track.album.images && track.album.images.length > 0) {
                        thumbnail = track.album.images[0].url;
                    }

                    newTracks.push({
                        id: 'sp-' + track.id + '-' + Date.now(), // unique ID
                        url: query,
                        title: title,
                        cleanTitle: title,
                        artist: artist,
                        duration: '00:00', // Unknown until yt-dlp resolves it
                        durationSec: 0,
                        thumbnail: thumbnail,
                        addedBy: job.userName,
                        addedAt: Date.now(),
                        isSpotifySearch: true // flag for frontend/backend if needed
                    });
                });

                room.queue.push(...newTracks);
                reorderQueue(room);
                broadcastRoomState(room);

                if (!room.isPlaying) {
                    playNext(room);
                }

                // Check if more
                if (data.next) {
                    job.offset += this.BATCH_SIZE;
                    // Move this room to back of line
                    this.roomOrder.push(roomId);
                } else {
                    console.log(`[Spotify] Finished playlist ${job.playlistId} for Room ${roomId}`);
                    roomJobs.shift(); // Done
                    this.roomOrder.push(roomId); // In case there are more jobs for this room
                }

            } else {
                console.log(`[Spotify] No items returned or error. Removing job.`);
                roomJobs.shift();
            }

        } catch (e) {
            console.error(`[Spotify] Error processing job: ${e.message}`);
            roomJobs.shift();
        }

        // Rate Limit delay
        await sleep(500);
        this.processNext();
    }
}

const spotifyClient = new SpotifyClient();
const spotifyScheduler = new SpotifyScheduler(spotifyClient);

module.exports = {
    spotifyClient,
    spotifyScheduler
};
