const { spawn } = require('child_process');

function getVideoInfo(url) {
    return new Promise((resolve, reject) => {
        const yt = spawn('yt-dlp', [
            '--cookies', 'cookies.txt',
            '--js-runtimes', 'node',
            '--dump-single-json',
            '--flat-playlist',
            '--extractor-args', 'youtubetab:skip=authcheck',
            '--playlist-end', '100',
            url
        ]);

        let data = '';
        yt.stdout.on('data', chunk => data += chunk);
        yt.stderr.on('data', chunk => console.error(`yt-dlp stderr: ${chunk}`));
        yt.on('close', code => {
            if (code === 0) {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(e);
                }
            } else {
                reject(new Error(`yt-dlp exited with code ${code}`));
            }
        });
    });
}

module.exports = {
    getVideoInfo
};
