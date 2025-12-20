const { spawn } = require('child_process');

class DownloadQueue {
    constructor() {
        this.queue = [];
        this.active = 0;
        this.maxConcurrent = 2;
        this.retryDelay = 5000;
        this.processing = false;

        this.requestTimestamps = [];
        this.maxRequestsPerSecond = 3;
    }

    add(url, type = 'info', spawnArgs = [], priority = 0, options = {}) {
        return new Promise((resolve, reject) => {
            const task = {
                url,
                type,
                spawnArgs,
                priority,
                options,
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
                const now = Date.now();
                this.requestTimestamps = this.requestTimestamps.filter(t => now - t < 1000);

                if (this.requestTimestamps.length >= this.maxRequestsPerSecond) {
                    const oldest = this.requestTimestamps[0];
                    const waitTime = 1000 - (now - oldest) + 50;
                    setTimeout(() => this.process(), waitTime);
                    break;
                }

                this.queue.sort((a, b) => {
                    if (a.priority !== b.priority) return b.priority - a.priority;
                    return a.addedAt - b.addedAt;
                });

                const task = this.queue.shift();
                this.active++;
                this.requestTimestamps.push(Date.now());

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
                const process = this.executeStream(task);
                task.resolve(process);
            }
        } catch (err) {
            if (this.shouldRetry(err, task)) {
                console.log(`[Queue] Task failed with 429/RateLimit. Retrying in ${this.retryDelay / 1000}s... (Attempt ${task.retries + 1})`);
                task.retries++;
                setTimeout(() => {
                    this.queue.unshift(task);
                    this.process();
                }, this.retryDelay + (Math.random() * 2000));
            } else {
                task.reject(err);
            }
        }
    }

    shouldRetry(err, task) {
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
                '--no-cache-dir',
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
        const spawnOptions = {};
        if (task.options && task.options.cwd) {
            spawnOptions.cwd = task.options.cwd;
        }
        return spawn('yt-dlp', task.spawnArgs, spawnOptions);
    }
}

module.exports = new DownloadQueue();
