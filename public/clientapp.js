const NAMES = [
    'bing bong', 'bong bing', 'ding dong', 'ping pong', 'sing song', 'wong tong',
    'bang bong', 'bung bong', 'bing bang', 'king kong', 'zing zong', 'bling bong',
    'king bong', 'bink bonk', 'blang blong', 'zong zing', 'bonkers bings',
    'bingle dangle', 'bongle bing', 'bingo bongo', 'pong ping', 'dong ding',
    'song sing', 'long strong', 'gong song', 'bongus', 'bingerton', 'bongeroni',
    'bingly', 'boing boing', 'boing bong', 'bing boing', 'bingle', 'bongo',
    'dingle dong', 'dongle ding', 'ringle rong', 'rongle ring', 'pinglet',
    'pongus', 'kling klong', 'klong kling', 'bingus', 'bungo', 'blingus',
    'blongo', 'zingle zongle', 'zongle zingle', 'binkus bonkus', 'bingus bongus',
    'bango bango', 'bango bingo', 'bigga bonga', 'bim bom', 'blim blom',
    'bring brong', 'bip bop', 'click clack', 'clink clonk', 'crink cronk',
    'dingo dongo', 'dink donk', 'fingle fangle', 'flim flam', 'fling flong',
    'gling glong', 'hingle hangle', 'jingle jangle', 'jing jong', 'kink konk',
    'ling long', 'ming mong', 'ning nong', 'pink ponk', 'pling plong',
    'prang prong', 'quing quong', 'ring rong', 'shing shong', 'sing songy',
    'sking skong', 'sling slong', 'sting stong', 'swing swong', 'thring throng',
    'ting tong', 'tring trong', 'ving vong', 'bimp bomp', 'wing wong',
    'wingle wangle', 'ying yong', 'zig zag', 'zing zang', 'zink zonk',
    'zip zap', 'zippity zong', 'zongle', 'zingle', 'binger bonger'
];

const elements = {
    urlInput: document.getElementById('urlInput'),
    addBtn: document.getElementById('addBtn'),
    tuneInBtn: document.getElementById('tuneInBtn'),
    skipBtn: document.querySelector('ion-icon[name="play-skip-forward-outline"]')?.parentElement,
    prevBtn: document.querySelector('ion-icon[name="play-skip-back-outline"]')?.parentElement,
    audioPlayer: document.getElementById('audioPlayer'),
    queueList: document.getElementById('queueList'),
    currentTitle: document.getElementById('currentTitle'),
    currentStatus: document.getElementById('currentStatus'),
    currentThumbnail: document.getElementById('currentThumbnail'),
    currentTimeDisplay: document.getElementById('currentTimeDisplay'),
    durationDisplay: document.getElementById('durationDisplay'),
    volumeSlider: document.getElementById('volume'),
    autoplayOverlay: document.getElementById('autoplayOverlay'),
    roomInput: document.getElementById('roomInputId'),
    nameInput: document.getElementById('nameInputId'),
    userListContainer: document.querySelector('.user-list'),
    liveBadge: document.querySelector('.live-badge'),
    modeBtns: {
        classic: document.getElementById('modeClassic'),
        roundrobin: document.getElementById('modeRoundRobin'),
        shuffle: document.getElementById('modeShuffle')
    },
    mobileMenu: document.getElementById('mobileMenuBtn'),
    sidebar: document.querySelector('.sidebar'),
    progressFill: () => document.querySelector('.progress-fill')
};

let state = {
    userId: localStorage.getItem('bingbox_userId') || generateId(5),
    userName: localStorage.getItem('bingbox_userName') || getRandomName(),
    roomId: new URLSearchParams(window.location.search).get('room'),
    isTunedIn: false,
    peerConnection: null,
    progressInterval: null,
    currentTrackDurationSec: 0,
    currentTrackStartTime: null,
    useWebSocketAudio: false,
    audioContext: null,
    gainNode: null,
    nextAudioTime: 0,
    isWsPlaying: false,
    liveBadgeClickCount: 0,
    liveBadgeClickTimer: null
};

if (!localStorage.getItem('bingbox_userId')) localStorage.setItem('bingbox_userId', state.userId);
if (!localStorage.getItem('bingbox_userName')) localStorage.setItem('bingbox_userName', state.userName);

if (!state.roomId) {
    state.roomId = generateId(5);
    const newUrl = `${window.location.pathname}?room=${state.roomId}`;
    window.history.replaceState({ path: newUrl }, '', newUrl);
}

if (elements.roomInput) elements.roomInput.value = state.roomId;
if (elements.nameInput) elements.nameInput.value = state.userName;

const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${protocol}://${window.location.host}`);

ws.onmessage = async (event) => {
    const data = (event.data instanceof ArrayBuffer) ? event.data : JSON.parse(event.data);
    if (data instanceof ArrayBuffer) {
        if (state.useWebSocketAudio && state.isWsPlaying) handleWsAudioChunk(data);
        return;
    }
    switch (data.type) {
        case 'UPDATE': updateUI(data); break;
        case 'OFFER': await handleOffer(data.sdp); break;
        case 'ICE_CANDIDATE': await handleCandidate(data.candidate); break;
        default: console.log('Unknown message type:', data.type);
    }
};

ws.onclose = () => {
    elements.currentStatus.innerText = 'Disconnected from server...';
    if (state.peerConnection) {
        state.peerConnection.close();
        state.peerConnection = null;
    }
};

if (ws.readyState === WebSocket.OPEN) {
    initWs();
} else {
    ws.onopen = initWs;
}

function initWs() {
    ws.binaryType = 'arraybuffer';
    sendJoinRoom();
    startStream();
}

function sendJoinRoom() {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'JOIN_ROOM',
            roomId: state.roomId,
            userId: state.userId,
            userName: state.userName
        }));
    }
}

elements.addBtn.addEventListener('click', () => {
    const url = elements.urlInput.value.trim();
    if (url) {
        elements.addBtn.disabled = true;
        const originalContent = elements.addBtn.innerHTML;
        elements.addBtn.innerHTML = '<div class="spinner"></div>';
        fetch('/api/queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, roomId: state.roomId, userId: state.userId, userName: state.userName })
        }).then(res => {
            if (res.ok) elements.urlInput.value = '';
            else alert('Failed to add track.');
        }).catch(err => {
            console.error(err);
            alert('Error adding track');
        }).finally(() => {
            elements.addBtn.disabled = false;
            elements.addBtn.innerHTML = originalContent;
        });
    }
});

elements.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') elements.addBtn.click();
});

elements.roomInput?.addEventListener('change', (e) => {
    const newRoom = e.target.value.trim().toUpperCase();
    if (newRoom && newRoom !== state.roomId) {
        state.roomId = newRoom;
        const newUrl = `${window.location.pathname}?room=${state.roomId}`;
        window.history.pushState({ path: newUrl }, '', newUrl);
        sendJoinRoom();
        updateUI({ queue: [], currentTrack: null, isPlaying: false });
    }
});

elements.nameInput?.addEventListener('change', (e) => {
    const newName = e.target.value.trim();
    if (newName) {
        state.userName = newName;
        localStorage.setItem('bingbox_userName', state.userName);
        sendJoinRoom();
    }
});

elements.autoplayOverlay.addEventListener('click', () => {
    elements.audioPlayer.play().then(() => {
        elements.autoplayOverlay.style.display = 'none';
    }).catch(e => console.error(e));
});

elements.tuneInBtn.addEventListener('click', () => {
    const icon = elements.tuneInBtn.querySelector('ion-icon');
    if (!state.isTunedIn) {
        startStream();
        return;
    }
    if (icon.name === 'pause-outline') {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'PAUSE' }));
    } else {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'RESUME' }));
        if (state.useWebSocketAudio && state.audioContext?.state === 'suspended') state.audioContext.resume();
        else if (!state.useWebSocketAudio && elements.audioPlayer.srcObject) elements.audioPlayer.play();
    }
});

elements.skipBtn?.addEventListener('click', () => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'SKIP' }));
});

elements.prevBtn?.addEventListener('click', () => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'PREVIOUS' }));
});

elements.volumeSlider.addEventListener('input', (e) => {
    const vol = parseFloat(e.target.value);
    elements.audioPlayer.volume = vol;
    if (state.gainNode) state.gainNode.gain.value = vol;
});

if (elements.modeBtns.classic) {
    elements.modeBtns.classic.addEventListener('click', () => sendMode('classic'));
    elements.modeBtns.roundrobin.addEventListener('click', () => sendMode('roundrobin'));
    elements.modeBtns.shuffle.addEventListener('click', () => sendMode('shuffle'));
}

function sendMode(mode) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'TOGGLE_QUEUE_MODE', mode }));
}

if (elements.mobileMenu && elements.sidebar) {
    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        elements.sidebar.parentNode.insertBefore(overlay, elements.sidebar.nextSibling);
        overlay.addEventListener('click', () => elements.sidebar.classList.remove('open'));
    }
    elements.mobileMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        elements.sidebar.classList.toggle('open');
    });
}

if (elements.liveBadge) {
    elements.liveBadge.addEventListener('click', () => {
        state.liveBadgeClickCount++;
        if (state.liveBadgeClickTimer) clearTimeout(state.liveBadgeClickTimer);
        state.liveBadgeClickTimer = setTimeout(() => state.liveBadgeClickCount = 0, 1000);
        if (state.liveBadgeClickCount >= 5) {
            state.useWebSocketAudio = !state.useWebSocketAudio;
            alert(`Switched to ${state.useWebSocketAudio ? 'WebSocket' : 'WebRTC'} Mode`);
            state.liveBadgeClickCount = 0;
            if (state.isTunedIn) {
                disconnectStream();
                setTimeout(startStream, 500);
            }
        }
    });
}

function updateUI(data) {
    if (data.currentTrack && data.isPlaying) {
        elements.currentTitle.innerText = data.currentTrack.cleanTitle || data.currentTrack.title;
        elements.currentStatus.innerText = data.currentTrack.artist || ((data.queue && data.queue.length > 0) ? 'Playing Now' : 'Last Track');
        elements.currentThumbnail.src = data.currentTrack.thumbnail || 'img/bingbong.webp';
        state.currentTrackDurationSec = data.currentTrack.durationSec || 0;
        if (data.startedAt) {
            const effectiveServerStart = data.startedAt + (data.totalPausedDuration || 0);
            const elapsedOnServer = (data.serverTime || Date.now()) - effectiveServerStart;
            state.currentTrackStartTime = Date.now() - elapsedOnServer;

            startProgressLoop(data.isPaused);
        } else {
            state.currentTrackStartTime = null;
            stopProgressLoop();
            elements.currentTimeDisplay.innerText = "Buffering...";
            updateProgressUI(0, state.currentTrackDurationSec);
        }
        const icon = elements.tuneInBtn.querySelector('ion-icon');
        if (icon) icon.name = data.isPaused ? 'play-outline' : 'pause-outline';
    } else {
        elements.currentTitle.innerText = 'Nothing Playing';
        elements.currentStatus.innerText = 'Queue is empty.';
        elements.currentThumbnail.src = 'img/bingbong.webp';
        const icon = elements.tuneInBtn.querySelector('ion-icon');
        if (icon) icon.name = 'play-outline';
        state.currentTrackDurationSec = 0;
        state.currentTrackStartTime = null;
        stopProgressLoop();
        updateProgressUI(0, 0);
    }
    if (elements.userListContainer && data.clients) {
        elements.userListContainer.innerHTML = '';
        data.clients.forEach(client => {
            const isMe = client.userId === state.userId;
            const div = document.createElement('div');
            div.className = 'user-item';
            div.innerHTML = `<div class="avatar">${client.userName.charAt(0).toUpperCase()}</div>
                <div class="user-info">
                    <span class="user-name">${client.userName} ${isMe ? '(You)' : ''}</span>
                    <span class="user-id-tag">[${client.userId}]</span>
                </div>`;
            elements.userListContainer.appendChild(div);
        });
        const countTitle = document.querySelector('.user-list-section .section-title');
        if (countTitle) countTitle.innerText = `Listeners (${data.clients.length})`;
    }
    elements.queueList.innerHTML = '';
    if (data.queue && data.queue.length > 0) {
        data.queue.forEach(track => {
            const div = document.createElement('div');
            div.className = 'queue-item';
            const timeStr = new Date(track.addedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            div.innerHTML = `<img class="queue-thumb" src="${track.thumbnail || 'img/bingbong.webp'}" onerror="this.src='img/bingbong.webp'">
                <div class="queue-info">
                    <div class="queue-title">${track.cleanTitle || track.title}</div>
                    <div class="queue-duration">
                        ${track.artist ? `<span class="queue-artist">${track.artist}</span> • ` : ''}
                        Added by <span class="added-by">${track.addedBy || 'Unknown'}</span>
                    </div>
                    <span class="queue-timestamp">Added at ${timeStr}</span>
                </div>
                <button class="remove-btn" onclick="removeTrack('${track.id}')">
                    <ion-icon name="trash-outline"></ion-icon>
                </button>`;
            elements.queueList.appendChild(div);
        });
    } else {
        elements.queueList.innerHTML = `<div class="queue-item queue-empty"><span class="queue-empty-text">Queue is empty</span></div>`;
    }
    if (data.queueMode) updateModeUI(data.queueMode);
}

function updateModeUI(mode) {
    if (!elements.modeBtns.classic) return;
    Object.values(elements.modeBtns).forEach(btn => btn.classList.remove('active'));
    if (mode === 'roundrobin') elements.modeBtns.roundrobin.classList.add('active');
    else if (mode === 'shuffle') elements.modeBtns.shuffle.classList.add('active');
    else elements.modeBtns.classic.classList.add('active');
}

function startProgressLoop(isPaused) {
    if (state.progressInterval) clearInterval(state.progressInterval);
    if (!isPaused) {
        state.progressInterval = setInterval(updateProgress, 1000);
        updateProgress();
    } else {
        updateProgress();
    }
}

function stopProgressLoop() {
    if (state.progressInterval) clearInterval(state.progressInterval);
    state.progressInterval = null;
}

function updateProgress() {
    if (!state.currentTrackStartTime || !state.currentTrackDurationSec) return;
    const now = Date.now();
    const elapsedSec = (now - state.currentTrackStartTime) / 1000;
    updateProgressUI(elapsedSec, state.currentTrackDurationSec);
}

function updateProgressUI(current, total) {
    const bar = elements.progressFill();
    if (current < 0) current = 0;
    if (total > 0 && current > total) current = total;
    const percentage = total > 0 ? (current / total) * 100 : 0;
    if (bar) bar.style.width = `${percentage}%`;
    if (elements.currentTimeDisplay) elements.currentTimeDisplay.innerText = formatTime(current);
    if (elements.durationDisplay) elements.durationDisplay.innerText = formatTime(total);
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function startStream() {
    state.isTunedIn = true;
    elements.tuneInBtn.classList.add('pulsing');
    if (state.useWebSocketAudio) startWebSocketAudio();
    else startWebRTC();
}

function disconnectStream() {
    state.isTunedIn = false;
    elements.tuneInBtn.classList.remove('pulsing');
    if (state.useWebSocketAudio) stopWebSocketAudio();
    else disconnectWebRTC();
}

async function startWebRTC() {
    ws.send(JSON.stringify({ type: 'JOIN_STREAM' }));
}

function disconnectWebRTC() {
    if (state.peerConnection) {
        state.peerConnection.close();
        state.peerConnection = null;
    }
    elements.audioPlayer.srcObject = null;
    ws.send(JSON.stringify({ type: 'LEAVE_STREAM' }));
}

function startWebSocketAudio() {
    if (!state.audioContext) {
        state.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
        state.gainNode = state.audioContext.createGain();
        state.gainNode.gain.value = parseFloat(elements.volumeSlider.value);
        state.gainNode.connect(state.audioContext.destination);
    }
    if (state.audioContext.state === 'suspended') state.audioContext.resume();
    state.nextAudioTime = state.audioContext.currentTime + 0.1;
    state.isWsPlaying = true;
    ws.send(JSON.stringify({ type: 'JOIN_STREAM_WS' }));
}

function stopWebSocketAudio() {
    state.isWsPlaying = false;
    if (state.audioContext) {
        state.audioContext.close();
        state.audioContext = null;
        state.gainNode = null;
    }
    ws.send(JSON.stringify({ type: 'LEAVE_STREAM' }));
}

function handleWsAudioChunk(arrayBuffer) {
    if (!state.audioContext || state.audioContext.state === 'closed') return;
    const int16 = new Int16Array(arrayBuffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;
    const audioBuffer = state.audioContext.createBuffer(1, float32.length, 48000);
    audioBuffer.copyToChannel(float32, 0);
    const source = state.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    if (state.gainNode) source.connect(state.gainNode);
    else source.connect(state.audioContext.destination);
    const now = state.audioContext.currentTime;
    if (state.nextAudioTime < now) state.nextAudioTime = now;
    source.start(state.nextAudioTime);
    state.nextAudioTime += audioBuffer.duration;
}

async function handleOffer(sdp) {
    state.peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    state.peerConnection.onicecandidate = (event) => {
        if (event.candidate) ws.send(JSON.stringify({ type: 'ICE_CANDIDATE', candidate: event.candidate }));
    };
    state.peerConnection.ontrack = (event) => {
        let stream = event.streams[0] || new MediaStream([event.track]);
        if (stream) {
            elements.audioPlayer.srcObject = stream;
            elements.audioPlayer.play().then(() => {
                elements.autoplayOverlay.style.display = 'none';
            }).catch(e => {
                if (e.name === 'NotAllowedError') elements.autoplayOverlay.style.display = 'flex';
            });
        }
    };
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await state.peerConnection.createAnswer();
    await state.peerConnection.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'ANSWER', sdp: state.peerConnection.localDescription }));
}

async function handleCandidate(candidate) {
    if (state.peerConnection) await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
}

window.removeTrack = function (trackId) {
    if (confirm('Remove this track from queue?')) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'REMOVE_TRACK', trackId }));
    }
};

function generateId(length = 5) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
}

function getRandomName() {
    return NAMES[Math.floor(Math.random() * NAMES.length)];
}
