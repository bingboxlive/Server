const downloadQueue = require('./download_queue');

function getVideoInfo(url) {
    return downloadQueue.add(url, 'info');
}

module.exports = {
    getVideoInfo
};
