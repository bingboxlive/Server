const Room = require('../models/Room');

const rooms = new Map();

function getOrCreateRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Room(roomId));
    }
    return rooms.get(roomId);
}

const clientPCs = new Map();

module.exports = {
    rooms,
    getOrCreateRoom,
    clientPCs
};
