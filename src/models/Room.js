class Room {
    constructor(roomId) {
        this.id = roomId;
        this.queue = [];
        this.history = [];
        this.currentTrack = null;
        this.isPlaying = false;
        this.isPaused = false;
        this.pausedAt = null;
        this.totalPausedDuration = 0;
        this.startTime = null;
        this.ffmpegProcess = null;
        this.ytDlpProcess = null;
        this.broadcastSource = null;
        this.broadcastSource = null;
        this.activeAudioSources = new Set();
        this.websocketAudioClients = new Set();
        this.clients = new Set();
        this.queueMode = 'classic';

        this.lastEmptyTime = Date.now();

        this.audioBuffer = Buffer.alloc(0);
        this.playbackInterval = null;
        this.nextAudioTime = 0;
        this.ffmpegFinished = false;
        this.BUFFER_HIGH_WATER_MARK = 1024 * 1024 * 2;
        this.BUFFER_LOW_WATER_MARK = 1024 * 512;
    }
}

module.exports = Room;
