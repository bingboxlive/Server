const downloadQueue = require('./download_queue');

function getVideoInfo(url, priority = 0) {
    return downloadQueue.add(url, 'info', [], priority);
}

module.exports = {
    getVideoInfo
};
