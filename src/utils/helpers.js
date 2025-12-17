const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function formatDuration(seconds) {
    if (!seconds) return '??:??';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function calculateSimilarity(s1, s2) {
    if (!s1 || !s2) return 0.0;
    const len1 = s1.length;
    const len2 = s2.length;
    const maxLen = Math.max(len1, len2);
    if (maxLen === 0) return 1.0;

    const matrix = [];
    for (let i = 0; i <= len2; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= len1; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= len2; i++) {
        for (let j = 1; j <= len1; j++) {
            if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    Math.min(
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    )
                );
            }
        }
    }

    const distance = matrix[len2][len1];
    return 1.0 - (distance / maxLen);
}

function cleanTitleString(str) {
    return str
        .replace(/\(Official.*?\)/gi, '')
        .replace(/\[Official.*?\]/gi, '')
        .replace(/\(ft\..*?\)/gi, '')
        .replace(/\(feat\..*?\)/gi, '')
        .replace(/ft\..*/gi, '')
        .replace(/feat\..*/gi, '')
        .replace(/\|/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

module.exports = {
    sleep,
    formatDuration,
    calculateSimilarity,
    cleanTitleString
};
