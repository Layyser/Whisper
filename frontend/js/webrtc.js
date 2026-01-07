// Logica de WebRTC: llamadas, datachannel y senalizacion
import { state } from './state.js';
import { config } from './config.js';
import { send } from './websocket.js';
import { showToast, updateConnectionStatus, storeMessage, displayMessageInDOM, updateUserList, loadMessageHistory } from './ui.js';

export async function initiatePeerConnection(userId) {
    // Creamos PC y lanzamos una oferta inicial sin medios (solo datachannel)
    const pc = createPeerConnection(userId, false);
    state.peerConnections[userId] = { pc };
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: 'offer', to: userId, data: offer });
}

export function createPeerConnection(peerId, includeVideo = false) {
    const pc = new RTCPeerConnection(config);

    pc.onconnectionstatechange = () => {
        console.log(`Connection state with ${peerId}:`, pc.connectionState);
        if (pc.connectionState === 'connected') {
            console.log('WebRTC fully connected!');
        }
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`ICE connection state with ${peerId}:`, pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
            showToast(`Connection with ${peerId} failed/disconnected`);
            const connStatus = document.getElementById('connStatus');
            if (connStatus) {
                connStatus.textContent = 'Connection Failed';
                connStatus.style.color = 'red';
            }
            
            if (state.isInCall && state.selectedUserId === peerId) {
                endCall(false);
            }
        }
    };

    pc.onicecandidate = async (event) => {
        if (event.candidate) {
            send({ type: 'ice-candidate', to: peerId, data: event.candidate });
        } else {
            console.log('ICE gathering complete');
            setTimeout(() => checkSelectedCandidate(pc, peerId), 2000);
        }
    };

    // IMPORTANT: Configure ontrack BEFORE anything else to catch all track events
    pc.ontrack = (event) => {
        console.log('>>> ontrack event fired!', event.track.kind, 'streams:', event.streams.length);
        const remoteVideo = document.getElementById('remoteVideo');
        if (event.streams && event.streams[0]) {
            console.log('Setting remote stream from ontrack');
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.play().catch(e => console.log('Remote video autoplay:', e));
        } else {
            // Fallback: create a new MediaStream if streams array is empty
            console.log('No streams in event, creating new MediaStream');
            if (!remoteVideo.srcObject) {
                remoteVideo.srcObject = new MediaStream();
            }
            remoteVideo.srcObject.addTrack(event.track);
            remoteVideo.play().catch(e => console.log('Remote video autoplay:', e));
        }
    };

    // Creamos un DataChannel para chat/archivos
    const dataChannel = pc.createDataChannel("chat");
    setupDataChannel(dataChannel, peerId);
    
    if (!state.peerConnections[peerId]) {
        state.peerConnections[peerId] = {};
    }
    state.peerConnections[peerId].dataChannel = dataChannel;

    // Don't add tracks here - they should be added explicitly before offer/answer

    pc.ondatachannel = (event) => {
        setupDataChannel(event.channel, peerId);
        if (!state.peerConnections[peerId]) {
            state.peerConnections[peerId] = {};
        }
        state.peerConnections[peerId].dataChannel = event.channel;
    };

    return pc;
}

function setupDataChannel(dataChannel, peerId) {
    // Maneja los eventos del canal de datos (texto, ping, archivos)
    dataChannel.onopen = () => {
        console.log('Data channel opened with', peerId);
        if (state.selectedUserId === peerId) {
            updateConnectionStatus(peerId);
        }
    };

    dataChannel.onclose = () => {
        console.log('Data channel closed with', peerId);
        if (state.selectedUserId === peerId) {
            updateConnectionStatus(peerId);
        }
    };

    dataChannel.onmessage = (event) => {
        if (typeof event.data === 'string') {
            const msg = JSON.parse(event.data);
            
            if (msg.type === 'text') {
                storeMessage(peerId, msg.data, false);
                
                if (state.selectedUserId === peerId) {
                    displayMessageInDOM(msg.data, false, new Date());
                } else {
                    state.unreadCounts[peerId] = (state.unreadCounts[peerId] || 0) + 1;
                    updateUserList();
                }
            } else if (msg.type === 'ping') {
                dataChannel.send(JSON.stringify({
                    type: 'pong',
                    timestamp: msg.timestamp
                }));
            } else if (msg.type === 'pong') {
                const latency = Date.now() - msg.timestamp;
                showToast(`P2P Latency: ${latency}ms ⚡`);
                
                if (state.selectedUserId === peerId) {
                    const div = document.createElement('div');
                    div.className = 'message system-message';
                    div.textContent = `⚡ P2P Round-Trip Time: ${latency}ms`;
                    div.style.textAlign = 'center';
                    div.style.color = '#2ecc71';
                    div.style.fontSize = '0.8em';
                    div.style.margin = '10px 0';
                    document.getElementById('messages').appendChild(div);
                }
            } else if (msg.type === 'file-start') {
                state.incomingFile = msg;
                state.incomingFileFrom = peerId;
                state.fileChunks = [];
            } else if (msg.type === 'file-end') {
                const blob = new Blob(state.fileChunks);
                const url = URL.createObjectURL(blob);
                
                storeMessage(state.incomingFileFrom, `📎 ${state.incomingFile.name}`, false, true, url, state.incomingFile.name);
                
                if (state.selectedUserId === state.incomingFileFrom) {
                    displayMessageInDOM(`📎 ${state.incomingFile.name}`, false, new Date(), true, url, state.incomingFile.name);
                } else {
                    state.unreadCounts[state.incomingFileFrom] = (state.unreadCounts[state.incomingFileFrom] || 0) + 1;
                    updateUserList();
                }
                
                state.incomingFile = null;
                state.incomingFileFrom = null;
                state.fileChunks = [];
            }
        } else {
            state.fileChunks.push(event.data);
        }
    };

    dataChannel.onerror = (error) => {
        console.error('Data channel error:', error);
    };
}

export async function checkSelectedCandidate(pc, peerId) {
    const stats = await pc.getStats();
    
    stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            console.log(`✅ Connexió activa amb ${peerId}:`, report);
        }
    });
}

export async function getConnectionType(pc) {
    const stats = await pc.getStats();
    let connectionType = 'unknown';
    
    stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            const localCandidateId = report.localCandidateId;
            stats.forEach(candidate => {
                if (candidate.id === localCandidateId && candidate.type === 'local-candidate') {
                    connectionType = candidate.candidateType;
                }
            });
        }
    });
    
    return connectionType;
}

export function requestCall(videoEnabled) {
    // Envia una peticion de llamada al peer seleccionado
    if (!state.selectedUserId) {
        showToast('Please select a user first');
        return;
    }
    if (state.isInCall) {
        showToast('You are already in a call!');
        return;
    }
    
    // Reset any stale call state
    state.incomingCallInfo = null;
    state.expectingCall = false;
    state.pendingCallVideo = videoEnabled;
    
    send({ type: 'call-request', to: state.selectedUserId, video: videoEnabled });
    showToast('Calling...');
}

export function acceptCall() {
    if (!state.incomingCallInfo) return;
    
    document.getElementById('incomingCallModal').classList.add('hidden');
    
    state.expectingCall = true;
    state.isInCall = true;
    
    send({ type: 'call-accept', to: state.incomingCallInfo.from });
    
    if (state.selectedUserId !== state.incomingCallInfo.from) {
        state.selectedUserId = state.incomingCallInfo.from;
        
        // Update UI to reflect the new selected user
        const user = state.currentUsers.find(u => u.id === state.selectedUserId);
        if (user) state.selectedUsername = user.username;
        else state.selectedUsername = state.incomingCallInfo.username || state.incomingCallInfo.from;

        document.getElementById('chatUsername').textContent = state.selectedUsername;
        document.getElementById('emptyState').classList.add('hidden');
        document.getElementById('chatView').classList.remove('hidden');
        document.querySelector('.main-content').classList.add('active');
        
        loadMessageHistory(state.selectedUserId);
        
        // Update active state in user list
        document.querySelectorAll('.user-item').forEach(item => item.classList.remove('active'));
        const userItems = document.querySelectorAll('.user-item');
        userItems.forEach(item => {
            const nameDiv = item.querySelector('.user-name');
            if (nameDiv && nameDiv.textContent.includes(state.selectedUsername)) {
                item.classList.add('active');
            }
        });
    }
}

export function rejectCall() {
    if (!state.incomingCallInfo) return;
    send({ type: 'call-reject', to: state.incomingCallInfo.from });
    document.getElementById('incomingCallModal').classList.add('hidden');
    state.incomingCallInfo = null;
    state.expectingCall = false;
    state.isInCall = false;
}

export async function startCall(videoEnabled = false) {
    // Arranca una llamada: pide micro/cam y envia offer
    if (!state.selectedUserId) return;

    state.isInCall = true;

    // Always get a fresh media stream for each call
    try {
        // Stop any existing stream first
        if (state.localStream) {
            state.localStream.getTracks().forEach(track => track.stop());
            state.localStream = null;
        }
        
        state.localStream = await navigator.mediaDevices.getUserMedia({
            video: videoEnabled,
            audio: true
        });
    } catch (err) {
        console.error("Error accessing devices:", err);
        let errorMsg = 'Error accessing media devices.';
        if (err.name === 'NotAllowedError') errorMsg = 'Permission denied. Please allow camera/mic access.';
        if (err.name === 'NotFoundError') errorMsg = 'No camera/mic found.';
        if (err.name === 'NotReadableError') errorMsg = 'Camera/mic is already in use by another app.';
        if (err.name === 'AbortError') errorMsg = 'Media access was aborted.';
        if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
            errorMsg += ' (HTTPS required)';
        }
        showToast(errorMsg);
        state.isInCall = false;
        state.expectingCall = false;
        return;
    }

    // Always create fresh connection for calls to ensure clean state
    let peerConn = state.peerConnections[state.selectedUserId];
    
    // Close any existing peer connection for calls
    if (peerConn && peerConn.pc) {
        peerConn.pc.close();
    }
    
    // Create new peer connection (ontrack is already set up in createPeerConnection)
    const pc = createPeerConnection(state.selectedUserId, false);
    state.peerConnections[state.selectedUserId] = { pc, dataChannel: peerConn?.dataChannel };
    peerConn = state.peerConnections[state.selectedUserId];

    // Show call UI
    document.getElementById('chatView').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('callView').classList.remove('hidden');
    
    const callType = videoEnabled ? 'Video Call' : 'Voice Call';
    document.getElementById('callUsername').innerHTML = `${state.selectedUsername} <br><small>${callType}</small>`;
    
    document.getElementById('localVideo').srcObject = state.localStream;
    document.getElementById('localVideo').style.display = videoEnabled ? 'block' : 'none';

    // Add all tracks to peer connection BEFORE creating offer
    console.log('Adding local tracks to PC...');
    state.localStream.getTracks().forEach(track => {
        console.log('Adding track to PC:', track.kind);
        peerConn.pc.addTrack(track, state.localStream);
    });

    const offer = await peerConn.pc.createOffer();
    await peerConn.pc.setLocalDescription(offer);
    send({ type: 'offer', to: state.selectedUserId, data: offer });

    startStatsMonitoring(peerConn.pc);
}

export function endCall(notifyPeer = true) {
    console.log('endCall called, notifyPeer:', notifyPeer);
    
    if (state.statsInterval) {
        clearInterval(state.statsInterval);
        state.statsInterval = null;
    }
    
    // Reset all call-related state
    state.isInCall = false;
    state.expectingCall = false;
    state.pendingCallVideo = false;
    state.incomingCallInfo = null;
    
    if (state.selectedUserId && notifyPeer) {
        send({ type: 'end-call', to: state.selectedUserId });
    }

    // Fully stop and release all media tracks
    if (state.localStream) {
        state.localStream.getTracks().forEach(track => {
            track.stop(); // This releases the hardware (mic/camera)
        });
        state.localStream = null; // Clear the stream so we get fresh one next call
    }

    // Clear video elements
    document.getElementById('remoteVideo').srcObject = null;
    document.getElementById('localVideo').srcObject = null;
    
    // Reset connection stats display
    const connStatus = document.getElementById('connStatus');
    const connType = document.getElementById('connType');
    const connBitrate = document.getElementById('connBitrate');
    if (connStatus) connStatus.textContent = 'Connecting...';
    if (connType) connType.textContent = '-';
    if (connBitrate) connBitrate.textContent = '0 kbps';
    
    // Show chat view
    document.getElementById('callView').classList.add('hidden');
    document.getElementById('chatView').classList.remove('hidden');
    document.getElementById('emptyState').classList.add('hidden');
    
    // Reset button states
    const audioBtn = document.getElementById('audioBtn');
    const videoBtn = document.getElementById('videoBtn');
    if (audioBtn) {
        audioBtn.classList.remove('muted');
        audioBtn.innerHTML = '<i class="fas fa-microphone"></i>';
    }
    if (videoBtn) {
        videoBtn.classList.remove('muted');
        videoBtn.innerHTML = '<i class="fas fa-video"></i>';
    }
}

export async function handleSignaling(msg) {
    let peerConn = state.peerConnections[msg.from];
    
    if (msg.type === 'call-request') {
        // Notificacion de llamada entrante
        if (state.isInCall) {
            // Auto-reject if busy
            send({ type: 'call-reject', to: msg.from });
            return;
        }

        state.incomingCallInfo = msg;
        let callerName = msg.username || msg.from;
        const user = state.currentUsers.find(u => u.id === msg.from);
        if (user) callerName = user.username;
        
        const callType = msg.video ? "Video Call" : "Voice Call";
        const icon = msg.video ? '<i class="fas fa-video"></i>' : '<i class="fas fa-phone"></i>';
        
        document.getElementById('callerName').innerHTML = `${icon} <strong>${callerName}</strong> is requesting a <strong>${callType}</strong>...`;
        document.getElementById('incomingCallModal').classList.remove('hidden');
        
    } else if (msg.type === 'call-accept') {
        showToast('Call accepted!');
        startCall(state.pendingCallVideo);
        
    } else if (msg.type === 'call-reject') {
        showToast('Call rejected or User Busy');
        state.incomingCallInfo = null;
        state.isInCall = false;
        state.expectingCall = false;
        state.pendingCallVideo = false;
        
    } else if (msg.type === 'offer') {
        // Recibimos offer: preparamos PC y respondemos con answer
        console.log('Received offer from:', msg.from, 'expectingCall:', state.expectingCall, 'isInCall:', state.isInCall);
        
        // For calls, always create fresh peer connection to ensure clean state
        if (state.expectingCall || state.isInCall) {
            // Close existing connection if any
            if (peerConn && peerConn.pc) {
                peerConn.pc.close();
            }
            const pc = createPeerConnection(msg.from, false);
            state.peerConnections[msg.from] = { pc, dataChannel: peerConn?.dataChannel };
            peerConn = state.peerConnections[msg.from];
        } else if (!peerConn) {
            const pc = createPeerConnection(msg.from, false);
            state.peerConnections[msg.from] = { pc };
            peerConn = state.peerConnections[msg.from];
        }
        
        // ontrack is already configured in createPeerConnection
        
        await peerConn.pc.setRemoteDescription(new RTCSessionDescription(msg.data));
        
        if (state.expectingCall) {
            // Stop any existing stream first
            if (state.localStream) {
                state.localStream.getTracks().forEach(track => track.stop());
                state.localStream = null;
            }
            
            try {
                const useVideo = state.incomingCallInfo ? state.incomingCallInfo.video : true;
                console.log('Getting user media for incoming call, video:', useVideo);
                state.localStream = await navigator.mediaDevices.getUserMedia({
                    video: useVideo,
                    audio: true
                });
                
                document.getElementById('localVideo').srcObject = state.localStream;
                document.getElementById('localVideo').style.display = useVideo ? 'block' : 'none';
                
                // Add all tracks to peer connection BEFORE creating answer
                console.log('Adding local tracks to PC for answer...');
                state.localStream.getTracks().forEach(track => {
                    console.log('Adding track to PC:', track.kind);
                    peerConn.pc.addTrack(track, state.localStream);
                });
                
                document.getElementById('chatView').classList.add('hidden');
                document.getElementById('emptyState').classList.add('hidden');
                document.getElementById('callView').classList.remove('hidden');
                
                const callType = useVideo ? 'Video Call' : 'Voice Call';
                const callerName = state.selectedUsername || msg.from;
                document.getElementById('callUsername').innerHTML = `${callerName} <br><small>${callType}</small>`;
                
                startStatsMonitoring(peerConn.pc);
                
            } catch (err) {
                console.error("Could not get local media", err);
                showToast('Error accessing media devices.');
                state.isInCall = false;
                state.expectingCall = false;
                return;
            }
            state.expectingCall = false;
        }

        const answer = await peerConn.pc.createAnswer();
        await peerConn.pc.setLocalDescription(answer);
        console.log('Sending answer to:', msg.from);
        send({ type: 'answer', to: msg.from, data: answer });
        
    } else if (msg.type === 'answer') {
        console.log('Received answer from:', msg.from);
        if (peerConn && peerConn.pc) {
            await peerConn.pc.setRemoteDescription(new RTCSessionDescription(msg.data));
            console.log('Remote description set, connection state:', peerConn.pc.connectionState);
        }
    } else if (msg.type === 'ice-candidate') {
        // Candidatos ICE para completar la conectividad
        if (peerConn && peerConn.pc) {
            await peerConn.pc.addIceCandidate(new RTCIceCandidate(msg.data));
        }
    } else if (msg.type === 'end-call') {
        endCall(false);
        showToast('Call ended');
    }
}

export function startStatsMonitoring(pc) {
    if (state.statsInterval) clearInterval(state.statsInterval);
    
    let lastBytesReceived = 0;
    let lastBytesSent = 0;
    let lastTimestamp = 0;

    state.statsInterval = setInterval(async () => {
        if (!pc) return;
        
        const stats = await pc.getStats();
        let activeCandidatePair = null;
        let bytesReceived = 0;
        let bytesSent = 0;
        let timestamp = Date.now();

        stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                activeCandidatePair = report;
                bytesReceived = report.bytesReceived;
                bytesSent = report.bytesSent;
            }
        });

        if (activeCandidatePair) {
            document.getElementById('connStatus').textContent = 'Connected (Encrypted)';
            document.getElementById('connStatus').style.color = '#00ff00';
            
            const localCand = stats.get(activeCandidatePair.localCandidateId);
            const remoteCand = stats.get(activeCandidatePair.remoteCandidateId);
            
            if (localCand && remoteCand) {
                const type = localCand.candidateType === 'relay' || remoteCand.candidateType === 'relay' 
                    ? 'TURN Relay (Server)' 
                    : 'P2P Direct (Local/STUN)';
                
                document.getElementById('connType').textContent = `${type}`;
                document.getElementById('connType').title = `Local: ${localCand.ip}:${localCand.port} <-> Remote: ${remoteCand.ip}:${remoteCand.port}`;
            }

            // Calculate Bitrate
            if (lastTimestamp > 0) {
                const duration = (timestamp - lastTimestamp) / 1000; // seconds
                const bitrateReceived = (bytesReceived - lastBytesReceived) * 8 / duration; // bits per second
                const bitrateSent = (bytesSent - lastBytesSent) * 8 / duration; // bits per second
                
                const totalBitrate = bitrateReceived + bitrateSent;
                const bitrateKbps = (totalBitrate / 1000).toFixed(0);
                
                document.getElementById('connBitrate').textContent = `${bitrateKbps} kbps`;
            }

            lastBytesReceived = bytesReceived;
            lastBytesSent = bytesSent;
            lastTimestamp = timestamp;
        }
    }, 1000);
}

export function toggleAudio() {
    if (state.localStream) {
        const audioTrack = state.localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            const btn = document.getElementById('audioBtn');
            btn.classList.toggle('muted');
            const icon = btn.querySelector('i');
            if (audioTrack.enabled) {
                icon.className = 'fas fa-microphone';
            } else {
                icon.className = 'fas fa-microphone-slash';
            }
        }
    }
}

export function toggleVideo() {
    if (state.localStream) {
        const videoTrack = state.localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            const btn = document.getElementById('videoBtn');
            btn.classList.toggle('muted');
            const icon = btn.querySelector('i');
            if (videoTrack.enabled) {
                icon.className = 'fas fa-video';
            } else {
                icon.className = 'fas fa-video-slash';
            }
        }
    }
}

export function sendPing() {
    if (!state.selectedUserId) return;
    const peerConn = state.peerConnections[state.selectedUserId];
    
    if (peerConn && peerConn.dataChannel && peerConn.dataChannel.readyState === 'open') {
        const timestamp = Date.now();
        peerConn.dataChannel.send(JSON.stringify({
            type: 'ping',
            timestamp: timestamp
        }));
        showToast('Ping sent! 📡');
    } else {
        showToast('Not connected via P2P');
    }
}

export function sendFile() {
    document.getElementById('fileInput').click();
}
