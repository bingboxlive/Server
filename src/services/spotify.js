const axios = require('axios');
const { rooms } = require('../state/store');
const { broadcastRoomState } = require('../socket/broadcaster');
const { sleep } = require('../utils/helpers');
const { playNext } = require('./playback');
const { reorderQueue } = require('./queue');
const { sourceResolver } = require('./source_resolver');

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
            this.tokenExpiresAt = Date.now() + (res.data.expires_in * 1000) - 60000;
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
            return res.data;
        } catch (e) {
            console.error('[Spotify] getPlaylistTracks failed:', e.message);
            return null;
        }
    }

    async searchPlaylist(query) {
        const token = await this.getToken();
        if (!token) throw new Error('No Spotify token');

        console.log(`[Spotify] Searching for playlist: "${query}"`);

        try {
            const res = await axios.get('https://api.spotify.com/v1/search', {
                headers: { 'Authorization': `Bearer ${token}` },
                params: {
                    q: query,
                    type: 'playlist',
                    limit: 5,
                    market: 'US'
                }
            });

            console.log('[Spotify] Search response status:', res.status);
            if (res.data && res.data.playlists) {
                const items = res.data.playlists.items.filter(i => i !== null);
                console.log(`[Spotify] Found ${res.data.playlists.items.length} raw results, ${items.length} valid playlists for query "${query}"`);

                if (items.length > 0) {
                    const first = items[0];
                    console.log(`[Spotify] First match: "${first.name}" (ID: ${first.id})`);
                    return first;
                } else {
                    console.warn(`[Spotify] Search returned 0 valid results for "${query}"`);
                }
            } else {
                console.log('[Spotify] invalid response format:', Object.keys(res.data));
            }
            return null;
        } catch (e) {
            console.error('[Spotify] searchPlaylist failed:', e.message);
            if (e.response) {
                console.error('[Spotify] API Error Data:', JSON.stringify(e.response.data));
            }
            return null;
        }
    }

    async getAlbumTracks(albumId, offset = 0, limit = 50) {
        const token = await this.getToken();
        if (!token) throw new Error('No Spotify token');

        try {
            const res = await axios.get(`https://api.spotify.com/v1/albums/${albumId}/tracks`, {
                headers: { 'Authorization': `Bearer ${token}` },
                params: { offset, limit }
            });
            return res.data;
        } catch (e) {
            console.error('[Spotify] getAlbumTracks failed:', e.message);
            return null;
        }
    }

    async searchAlbum(query) {
        const token = await this.getToken();
        if (!token) throw new Error('No Spotify token');

        console.log(`[Spotify] Searching for album: "${query}"`);

        try {
            const res = await axios.get('https://api.spotify.com/v1/search', {
                headers: { 'Authorization': `Bearer ${token}` },
                params: {
                    q: query,
                    type: 'album',
                    limit: 5,
                    market: 'US'
                }
            });

            console.log('[Spotify] Album Search response status:', res.status);
            if (res.data && res.data.albums) {
                const items = res.data.albums.items.filter(i => i !== null);
                console.log(`[Spotify] Found ${res.data.albums.items.length} raw results, ${items.length} valid albums for query "${query}"`);

                if (items.length > 0) {
                    const first = items[0];
                    console.log(`[Spotify] First match: "${first.name}" (ID: ${first.id})`);
                    return first;
                } else {
                    console.warn(`[Spotify] Album Search returned 0 valid results for "${query}"`);
                }
            } else {
                console.log('[Spotify] invalid response format:', Object.keys(res.data));
            }
            return null;
        } catch (e) {
            console.error('[Spotify] searchAlbum failed:', e.message);
            if (e.response) {
                console.error('[Spotify] API Error Data:', JSON.stringify(e.response.data));
            }
            return null;
        }
    }
}

class SpotifyScheduler {
    constructor(client) {
        this.client = client;
        this.jobs = new Map();
        this.roomOrder = [];
        this.isProcessing = false;
        this.BATCH_SIZE = 50;
    }

    enqueueCollection(roomId, id, type, userName, thumbnail = null) {
        if (!this.jobs.has(roomId)) {
            this.jobs.set(roomId, []);
            this.roomOrder.push(roomId);
        }

        this.jobs.get(roomId).push({
            id,
            type: type || 'playlist',
            offset: 0,
            userName,
            thumbnail
        });

        console.log(`[Spotify] ${type} ${id} queued for Room ${roomId}`);
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
            return this.processNext();
        }

        const job = roomJobs[0];
        const room = rooms.get(roomId);

        if (!room) {
            console.log(`[Spotify] Room ${roomId} not found. Dropping job.`);
            roomJobs.shift();
            return this.processNext();
        }

        try {
            console.log(`[Spotify] Processing batch for Room ${roomId} (Type: ${job.type}, Offset: ${job.offset})`);

            let data = null;
            if (job.type === 'album') {
                data = await this.client.getAlbumTracks(job.id, job.offset, this.BATCH_SIZE);
            } else {
                data = await this.client.getPlaylistTracks(job.id, job.offset, this.BATCH_SIZE);
            }

            if (data && data.items && data.items.length > 0) {
                const newTracks = [];

                data.items.forEach(item => {
                    const track = (job.type === 'album') ? item : item.track;
                    if (!track || !track.id) return;

                    const artist = track.artists.map(a => a.name).join(', ');
                    const title = track.name;
                    const query = `ytsearch1:${artist} - ${title}`;

                    let thumbnail = null;
                    if (job.type === 'album') {
                        thumbnail = job.thumbnail;
                    } else if (track.album && track.album.images && track.album.images.length > 0) {
                        thumbnail = track.album.images[0].url;
                    }

                    newTracks.push({
                        id: 'sp-' + track.id + '-' + Date.now(),
                        url: query,
                        title: title,
                        cleanTitle: title,
                        artist: artist,
                        duration: '00:00',
                        durationSec: 0,
                        thumbnail: thumbnail,
                        addedBy: job.userName,
                        addedAt: Date.now(),
                        isSpotifySearch: true
                    });
                });

                room.queue.push(...newTracks);
                reorderQueue(room);
                broadcastRoomState(room);

                sourceResolver.notifyRoom(roomId);

                if (!room.isPlaying) {
                    playNext(room);
                }

                if (data.next) {
                    job.offset += this.BATCH_SIZE;
                    this.roomOrder.push(roomId);
                } else {
                    console.log(`[Spotify] Finished ${job.type} ${job.id} for Room ${roomId}`);
                    roomJobs.shift();
                    this.roomOrder.push(roomId);
                }

            } else {
                console.log(`[Spotify] No items returned or error. Removing job.`);
                roomJobs.shift();
            }

        } catch (e) {
            console.error(`[Spotify] Error processing job: ${e.message}`);
            roomJobs.shift();
        }

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
