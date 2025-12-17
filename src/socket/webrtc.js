const { RTCPeerConnection, nonstandard } = require('wrtc');
const { RTCAudioSource } = nonstandard;
const { clientPCs, getOrCreateRoom, rooms } = require('../state/store');

const RTC_CONFIG = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

async function handleJoinStream(ws) {
    console.log('Client joining stream via WebRTC');
    const pc = new RTCPeerConnection(RTC_CONFIG);
    clientPCs.set(ws, pc);

    const source = new RTCAudioSource();
    const track = source.createTrack();
    pc.addTrack(track);

    if (ws.roomId) {
        const room = getOrCreateRoom(ws.roomId);
        room.activeAudioSources.add(source);
        ws.audioSource = source;
    }

    ws.on('close', () => {
        console.log('Client disconnected, closing PC');
        pc.close();
        clientPCs.delete(ws);

        if (ws.roomId && ws.audioSource) {
            const room = rooms.get(ws.roomId);
            if (room) {
                room.activeAudioSources.delete(ws.audioSource);
            }
        }
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    ws.send(JSON.stringify({ type: 'OFFER', sdp: pc.localDescription }));

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({ type: 'ICE_CANDIDATE', candidate: event.candidate }));
        }
    };
}

async function handleAnswer(ws, answer) {
    const pc = clientPCs.get(ws);
    if (pc) {
        await pc.setRemoteDescription(answer);
        console.log('Set Remote Description (Answer)');
    }
}

async function handleCandidate(ws, candidate) {
    const pc = clientPCs.get(ws);
    if (!pc) return;

    try {
        await pc.addIceCandidate(candidate);
    } catch (e) {
        if (candidate.candidate && candidate.candidate.length > 0) {
            console.error('Error adding ICE candidate:', e.message);
        }
    }
}

module.exports = {
    handleJoinStream,
    handleAnswer,
    handleCandidate
};
