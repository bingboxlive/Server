function reorderQueue(room) {
    if (room.queue.length <= 1) return;

    if (room.queueMode === 'classic') {
        room.queue.sort((a, b) => a.addedAt - b.addedAt);
    } else if (room.queueMode === 'roundrobin') {
        const userQueues = new Map();
        room.queue.forEach(track => {
            const key = track.addedBy || 'Anonymous';
            if (!userQueues.has(key)) userQueues.set(key, []);
            userQueues.get(key).push(track);
        });

        userQueues.forEach(tracks => {
            tracks.sort((a, b) => a.addedAt - b.addedAt);
        });

        const userOrder = Array.from(userQueues.keys()).sort((u1, u2) => {
            const t1 = userQueues.get(u1)[0].addedAt;
            const t2 = userQueues.get(u2)[0].addedAt;
            return t1 - t2;
        });

        const newQueue = [];
        let note = true;
        while (note) {
            note = false;
            for (const user of userOrder) {
                const tracks = userQueues.get(user);
                if (tracks.length > 0) {
                    newQueue.push(tracks.shift());
                    note = true;
                }
            }
        }
        room.queue = newQueue;
    } else if (room.queueMode === 'shuffle') {
        for (let i = room.queue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [room.queue[i], room.queue[j]] = [room.queue[j], room.queue[i]];
        }
    }
}

module.exports = {
    reorderQueue
};
