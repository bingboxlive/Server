const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { rooms, getOrCreateRoom } = require('../state/store');
const { getVideoInfo } = require('../services/downloader');
const { getMusicBrainzMetadata, metadataScheduler } = require('../services/metadata');
const { reorderQueue } = require('../services/queue');
const { broadcastRoomState } = require('../socket/broadcaster');
const { playNext } = require('../services/playback');
const { formatDuration } = require('../utils/helpers');
const { spotifyClient, spotifyScheduler } = require('../services/spotify');

const indexHtmlPath = path.join(__dirname, '../../public', 'index.html');
const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');

router.get('/', (req, res, next) => {
    if (req.query.room) {
        const roomId = req.query.room;
        const room = rooms.get(roomId);

        let title = `Room ${roomId} - BingBox Live`;
        let description = 'Join the listening party on BingBox!';
        let image = 'img/bingbong.webp';

        if (room && room.currentTrack) {
            const trackTitle = room.currentTrack.cleanTitle || room.currentTrack.title;
            const trackArtist = room.currentTrack.artist || 'Unknown Artist';
            description = `Currently Listening to ${trackTitle} - ${trackArtist}`;

            if (room.queue && room.queue.length > 0) {
                const nextTrack = room.queue[0];
                const nextTitle = nextTrack.cleanTitle || nextTrack.title;
                const nextArtist = nextTrack.artist || 'Unknown Artist';
                description += `. Up Next: ${nextTitle} - ${nextArtist}`;
            }

            if (room.currentTrack.thumbnail) {
                image = room.currentTrack.thumbnail;
            }
        } else if (room) {
            description = 'Join the room and start adding songs!';
        } else {
            description = `Join Room ${roomId} on BingBox Live.`;
        }

        let modifiedHtml = indexHtmlContent
            .replace('<title>BingBox Live</title>', `<title>${title}</title>`)
            .replace('content="BingBox Live"', `content="${title}"`)
            .replace(/content="Turn Bing Bong into your group speaker[^"]*"/, `content="${description}"`)
            .replace('content="img/bingbong.webp"', `content="${image}"`);

        return res.send(modifiedHtml);
    }
    next();
});

router.post('/api/queue', async (req, res) => {
    const { url, roomId, userId, userName } = req.body;
    if (!url || !roomId) return res.status(400).send('URL and Room ID required');

    const room = getOrCreateRoom(roomId);

    let targetUrl = url;
    let isSearch = false;
    let isSpotify = false;

    try {
        const u = new URL(url);
        const host = u.hostname.toLowerCase();
        const allowedDomains = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com', 'www.music.youtube.com'];
        const spotifyDomains = ['open.spotify.com', 'spotify.com'];

        if (spotifyDomains.includes(host) || host.endsWith('.spotify.com')) {
            isSpotify = true;
        } else {
            const isYt = allowedDomains.includes(host) || host.endsWith('.youtube.com');
            if (!isYt) {
                return res.status(400).json({ error: 'Only YouTube and Spotify links are supported' });
            }
        }
    } catch (e) {
        isSearch = true;
        targetUrl = `ytsearch1:${url}`;
        console.log(`[Room ${roomId}] Input '${url}' treated as search: ${targetUrl}`);
    }

    if (isSpotify) {
        try {
            const u = new URL(url);
            const pathSegments = u.pathname.split('/').filter(p => p.length > 0);
            // usually /track/<id> or /playlist/<id>

            const type = pathSegments[0];
            const id = pathSegments[1];

            if (type === 'track') {
                const trackData = await spotifyClient.getTrack(id);
                if (!trackData) return res.status(404).json({ error: 'Spotify track not found' });

                const artist = trackData.artists.map(a => a.name).join(', ');
                const title = trackData.name;
                const query = `ytsearch1:${artist} - ${title}`;

                let thumbnail = null;
                if (trackData.album && trackData.album.images && trackData.album.images.length > 0) {
                    thumbnail = trackData.album.images[0].url;
                }

                const track = {
                    id: 'sp-' + trackData.id + '-' + Date.now(),
                    url: query,
                    title: title,
                    cleanTitle: title,
                    artist: artist,
                    duration: '00:00',
                    durationSec: 0,
                    thumbnail: thumbnail,
                    addedBy: userName || 'Anonymous',
                    addedAt: Date.now(),
                    isSpotifySearch: true
                };

                room.queue.push(track);
                reorderQueue(room);
                broadcastRoomState(room);

                if (!room.isPlaying) {
                    playNext(room);
                }

                return res.json(track);

            } else if (type === 'playlist') {
                spotifyScheduler.enqueuePlaylist(roomId, id, userName || 'Anonymous');
                return res.json({ message: 'Spotify playlist queued for background import.' });
            } else {
                return res.status(400).json({ error: 'Unsupported Spotify link type (only Track/Playlist)' });
            }

        } catch (e) {
            console.error('[Spotify] Error processing URL:', e);
            return res.status(500).json({ error: 'Failed to process Spotify link' });
        }
    }

    // Existing YouTube Logic
    try {
        const info = await getVideoInfo(targetUrl);

        const newTracks = [];

        if (info._type === 'playlist' || (info.entries && info.entries.length > 0)) {
            console.log(`[Room ${roomId}] Detected Playlist: ${info.title} (${info.entries.length} entries)`);

            for (const entry of info.entries) {
                if (!entry.title || entry.title === '[Private video]') continue;

                const entryUrl = entry.url || `https://www.youtube.com/watch?v=${entry.id}`;

                let thumb = null;
                if (entry.thumbnails && entry.thumbnails.length > 0) {
                    thumb = entry.thumbnails[entry.thumbnails.length - 1].url;
                }

                newTracks.push({
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                    url: entryUrl,
                    title: entry.title,
                    cleanTitle: entry.title,
                    artist: null,
                    duration: entry.duration_string || formatDuration(entry.duration),
                    durationSec: entry.duration || 0,
                    thumbnail: thumb,
                    addedBy: userName || 'Anonymous',
                    addedAt: Date.now()
                });
            }

            room.queue.push(...newTracks);
            reorderQueue(room);
            broadcastRoomState(room);

            if (!room.isPlaying) {
                playNext(room);
            }

            metadataScheduler.enqueue(roomId, newTracks);

            res.json({ message: `Added ${newTracks.length} tracks from playlist` });

        } else {
            const finalUrl = info.webpage_url || info.url || targetUrl;

            let cleanTitle = info.title;
            let artist = null;
            let thumbnail = info.thumbnail;

            const metadata = await getMusicBrainzMetadata(info.title);
            if (metadata) {
                cleanTitle = metadata.title;
                artist = metadata.artist;
                if (metadata.coverArt) {
                    thumbnail = metadata.coverArt;
                    console.log(`[MusicBrainz] Using Cover Art: ${thumbnail}`);
                }
            }

            const track = {
                id: Date.now().toString(),
                url: finalUrl,
                title: info.title || 'Unknown Title',
                cleanTitle: cleanTitle || info.title,
                artist: artist,
                duration: info.duration_string || '??:??',
                durationSec: info.duration || 0,
                thumbnail: thumbnail,
                addedBy: userName || 'Anonymous',
                addedAt: Date.now()
            };

            room.queue.push(track);
            reorderQueue(room);
            broadcastRoomState(room);

            if (!room.isPlaying) {
                playNext(room);
            }

            res.json(track);
        }

    } catch (e) {
        console.error('Error adding to queue:', e);
        res.status(500).json({ error: 'Failed to add video' });
    }
});

module.exports = router;
