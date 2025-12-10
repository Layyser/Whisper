import { state } from './state.js';
import { config } from './config.js';
import { send } from './websocket.js';
import { showToast, updateConnectionStatus, storeMessage, displayMessageInDOM, updateUserList, loadMessageHistory } from './ui.js';

export async function initiatePeerConnection(userId) {
    const pc = createPeerConnection(userId, false);
    state.peerConnections[userId] = { pc };
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: 'offer', to: userId, data: offer });
}

export function createPeerConnection(peerId, includeVideo = false) {
    const pc = new RTCPeerConnection(config);

    pc.onconnectionstatechange = () => {
        console.log(`Estat de connexió amb ${peerId}:`, pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`Estat de connexió ICE amb ${peerId}:`, pc.iceConnectionState);
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
            console.log('Recopilació ICE completa');
            setTimeout(() => checkSelectedCandidate(pc, peerId), 2000);
        }
    };

    const dataChannel = pc.createDataChannel("chat");
    setupDataChannel(dataChannel, peerId);
    
    if (!state.peerConnections[peerId]) {
        state.peerConnections[peerId] = {};
    }
    state.peerConnections[peerId].dataChannel = dataChannel;

    if (state.localStream) {
        state.localStream.getTracks().forEach(track => {
            pc.addTrack(track, state.localStream);
        });
    }

    pc.ontrack = (event) => {
        document.getElementById('remoteVideo').srcObject = event.streams[0];
    };

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
    if (!state.selectedUserId) return;
    if (state.isInCall) {
        showToast('You are already in a call!');
        return;
    }
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
}

export async function startCall(videoEnabled = false) {
    if (!state.selectedUserId) return;

    state.isInCall = true;

    if (!state.localStream) {
        try {
            state.localStream = await navigator.mediaDevices.getUserMedia({
                video: videoEnabled,
                audio: true
            });
        } catch (err) {
            console.error("Error accedint als dispositius:", err);
            let errorMsg = 'Error accessing media devices.';
            if (err.name === 'NotAllowedError') errorMsg = 'Permission denied. Please allow camera/mic access.';
            if (err.name === 'NotFoundError') errorMsg = 'No camera/mic found.';
            if (err.name === 'NotReadableError') errorMsg = 'Camera/mic is already in use.';
            if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
                errorMsg += ' (HTTPS required)';
            }
            showToast(errorMsg);
            state.isInCall = false;
            return;
        }
    } else {
        state.localStream.getAudioTracks().forEach(track => track.enabled = true);
        state.localStream.getVideoTracks().forEach(track => track.enabled = videoEnabled);
        
        if (videoEnabled && state.localStream.getVideoTracks().length === 0) {
             try {
                const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
                const videoTrack = videoStream.getVideoTracks()[0];
                state.localStream.addTrack(videoTrack);
            } catch (e) {
                console.error("Could not add video track", e);
            }
        }
    }

    // Ensure we have a fresh connection for the call
    let peerConn = state.peerConnections[state.selectedUserId];
    
    // If connection exists but is closed or failed, recreate it
    if (peerConn && peerConn.pc && (peerConn.pc.connectionState === 'closed' || peerConn.pc.connectionState === 'failed')) {
        peerConn.pc.close();
        delete state.peerConnections[state.selectedUserId];
        peerConn = null;
    }

    if (!peerConn || !peerConn.pc) {
        const pc = createPeerConnection(state.selectedUserId, false);
        state.peerConnections[state.selectedUserId] = { pc };
        peerConn = state.peerConnections[state.selectedUserId];
    }

    document.getElementById('chatView').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('callView').classList.remove('hidden');
    
    const callType = videoEnabled ? 'Video Call' : 'Voice Call';
    document.getElementById('callUsername').innerHTML = `${state.selectedUsername} <br><small>${callType}</small>`;
    
    document.getElementById('localVideo').srcObject = state.localStream;
    
    document.getElementById('localVideo').style.display = videoEnabled ? 'block' : 'none';

    // Add tracks if not already added
    const senders = peerConn.pc.getSenders();
    state.localStream.getTracks().forEach(track => {
        const sender = senders.find(s => s.track && s.track.kind === track.kind);
        if (!sender) {
            peerConn.pc.addTrack(track, state.localStream);
        } else {
            sender.replaceTrack(track);
        }
    });

    peerConn.pc.ontrack = (event) => {
        document.getElementById('remoteVideo').srcObject = event.streams[0];
    };

    const offer = await peerConn.pc.createOffer();
    await peerConn.pc.setLocalDescription(offer);
    send({ type: 'offer', to: state.selectedUserId, data: offer });

    startStatsMonitoring(peerConn.pc);
}

export function endCall(notifyPeer = true) {
    if (state.statsInterval) clearInterval(state.statsInterval);
    state.isInCall = false;
    
    if (state.selectedUserId) {
        if (notifyPeer) {
            send({ type: 'end-call', to: state.selectedUserId });
        }

        if (state.peerConnections[state.selectedUserId]) {
            const peerConn = state.peerConnections[state.selectedUserId];
            
            if (peerConn.pc) {
                const senders = peerConn.pc.getSenders();
                senders.forEach(sender => {
                    if (sender.track) {
                        // Don't remove track, just stop sending? 
                        // Actually, removing track is cleaner for renegotiation next time
                        peerConn.pc.removeTrack(sender);
                    }
                });
                // We don't close the PC here to keep DataChannel alive for chat
                // But for a clean call state, maybe we should renegotiate to remove tracks?
                // Or just keep it open. The user issue was "can't call again".
                // If we close PC, we lose chat.
                // Let's try to keep PC open but stop media.
            }
        }
    }

    if (state.localStream) {
        state.localStream.getTracks().forEach(track => {
            track.enabled = false;
        });
    }

    state.incomingCallInfo = null;
    document.getElementById('remoteVideo').srcObject = null;
    document.getElementById('localVideo').srcObject = null;
    document.getElementById('callView').classList.add('hidden');
    document.getElementById('chatView').classList.remove('hidden');
    document.getElementById('emptyState').classList.add('hidden');
    
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
        
    } else if (msg.type === 'offer') {
        if (!peerConn) {
            const pc = createPeerConnection(msg.from, false);
            state.peerConnections[msg.from] = { pc };
            peerConn = state.peerConnections[msg.from];
        }
        
        await peerConn.pc.setRemoteDescription(new RTCSessionDescription(msg.data));
        
        if (state.expectingCall && !state.localStream) {
             try {
                const useVideo = state.incomingCallInfo ? state.incomingCallInfo.video : true;
                state.localStream = await navigator.mediaDevices.getUserMedia({
                    video: useVideo,
                    audio: true
                });
                
                document.getElementById('localVideo').srcObject = state.localStream;
                document.getElementById('localVideo').style.display = useVideo ? 'block' : 'none';
                
                state.localStream.getTracks().forEach(track => {
                    peerConn.pc.addTrack(track, state.localStream);
                });
                
                document.getElementById('chatView').classList.add('hidden');
                document.getElementById('callView').classList.remove('hidden');
                
                const callType = useVideo ? 'Video Call' : 'Voice Call';
                const callerName = state.selectedUsername || msg.from;
                document.getElementById('callUsername').innerHTML = `${callerName} <br><small>${callType}</small>`;
                
            } catch (err) {
                console.error("Could not get local media", err);
                showToast('Error accessing media devices.');
            }
            state.expectingCall = false;
        } else if (state.expectingCall && state.localStream) {
             const useVideo = state.incomingCallInfo ? state.incomingCallInfo.video : true;
             
             state.localStream.getAudioTracks().forEach(track => track.enabled = true);
             state.localStream.getVideoTracks().forEach(track => track.enabled = useVideo);

             document.getElementById('localVideo').style.display = useVideo ? 'block' : 'none';

             document.getElementById('chatView').classList.add('hidden');
             document.getElementById('callView').classList.remove('hidden');
             
             const callType = useVideo ? 'Video Call' : 'Voice Call';
             const callerName = state.selectedUsername || msg.from;
             document.getElementById('callUsername').innerHTML = `${callerName} <br><small>${callType}</small>`;
             
             state.expectingCall = false;
        }

        const answer = await peerConn.pc.createAnswer();
        await peerConn.pc.setLocalDescription(answer);
        send({ type: 'answer', to: msg.from, data: answer });
        
    } else if (msg.type === 'answer') {
        if (peerConn && peerConn.pc) {
            await peerConn.pc.setRemoteDescription(new RTCSessionDescription(msg.data));
        }
    } else if (msg.type === 'ice-candidate') {
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
