const { spawn } = require('child_process');

class DownloadQueue {
    constructor() {
        this.queue = [];
        this.active = 0;
        this.maxConcurrent = 3; // Keep this low to avoid strict IP bans
        this.retryDelay = 5000;
        this.processing = false;
    }

    /**
     * @param {string} url - YouTube URL
     * @param {string} type - 'info' | 'stream'
     * @param {Array} spawnArgs - Arguments for spawn (only for 'stream')
     * @returns {Promise}
     */
    add(url, type = 'info', spawnArgs = []) {
        return new Promise((resolve, reject) => {
            const task = {
                url,
                type,
                spawnArgs,
                resolve,
                reject,
                addedAt: Date.now(),
                retries: 0
            };
            this.queue.push(task);
            this.process();
        });
    }

    async process() {
        if (this.processing) return;
        this.processing = true;

        try {
            while (this.active < this.maxConcurrent && this.queue.length > 0) {
                // FIFO: Sort by addedAt to ensure oldest get priority
                this.queue.sort((a, b) => a.addedAt - b.addedAt);

                const task = this.queue.shift();
                this.active++;

                this.execute(task).then(() => {
                    this.active--;
                    this.process();
                }).catch(() => {
                    this.active--;
                    this.process();
                });
            }
        } finally {
            this.processing = false;
        }
    }

    async execute(task) {
        try {
            if (task.type === 'info') {
                const result = await this.executeInfo(task);
                task.resolve(result);
            } else if (task.type === 'stream') {
                // For streams, we resolve effectively "immediately" once the process starts
                // The Caller handles the process events
                const process = this.executeStream(task);
                task.resolve(process);
            }
        } catch (err) {
            if (this.shouldRetry(err, task)) {
                console.log(`[Queue] Task failed with 429/RateLimit. Retrying in ${this.retryDelay / 1000}s... (Attempt ${task.retries + 1})`);
                task.retries++;
                setTimeout(() => {
                    this.queue.unshift(task); // Put back in front
                    this.process();
                }, this.retryDelay + (Math.random() * 2000));
            } else {
                task.reject(err);
            }
        }
    }

    shouldRetry(err, task) {
        // Retry if it's a 429 or "Too Many Requests" message
        if (task.retries > 5) return false;
        if (err.message && (err.message.includes('429') || err.message.includes('Too Many Requests'))) {
            return true;
        }
        return false;
    }

    executeInfo(task) {
        return new Promise((resolve, reject) => {
            const yt = spawn('yt-dlp', [
                '--cookies', 'cookies.txt',
                '--js-runtimes', 'node',
                '--dump-single-json',
                '--flat-playlist',
                '--extractor-args', 'youtubetab:skip=authcheck',
                '--playlist-end', '100',
                task.url
            ]);

            let data = '';
            let errorData = '';

            yt.stdout.on('data', chunk => data += chunk);
            yt.stderr.on('data', chunk => errorData += chunk);

            yt.on('close', code => {
                if (code === 0) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error('Failed to parse yt-dlp JSON'));
                    }
                } else {
                    reject(new Error(`yt-dlp exited with code ${code}: ${errorData}`));
                }
            });
        });
    }

    executeStream(task) {
        // Just spawns and returns the process, caller handles pipes
        // Note: For streams, if they fail immediately with 429, it might be harder to catch here
        // without waiting for at least some output. 
        // But for now, let's assume the rate limit usually hits metadata fetching first.
        return spawn('yt-dlp', task.spawnArgs);
    }
}

module.exports = new DownloadQueue();
