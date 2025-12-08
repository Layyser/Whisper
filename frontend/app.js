let ws;
let myId;
let myUsername;
let peerConnections = {}; // { userId: { pc, dataChannel, ... } }
let incomingCall = {}; // { userId: true/false }
let localStream;
let selectedUserId;
let selectedUsername;

// Historial de missatges per usuari
let messageHistory = {}; // { userId: [ {text, isSent, timestamp, isFile, fileUrl}, ... ] }
let unreadCounts = {};   // { userId: number }

// Estat de recepció de fitxers
let incomingFile = null;
let fileChunks = [];
let incomingFileFrom = null; // Rastrejar qui envia el fitxer

const config = {
    iceServers: [
      {
        urls: "stun:stun.l.google.com:19302",
      },
      {
        urls: "turn:global.relay.metered.ca:80",
        username: "24d95e537cd2acc083268cdb",
        credential: "O9Mo4JnvwlmyxXJA",
      },
      {
        urls: "turn:global.relay.metered.ca:80?transport=tcp",
        username: "24d95e537cd2acc083268cdb",
        credential: "O9Mo4JnvwlmyxXJA",
      },
      {
        urls: "turn:global.relay.metered.ca:443",
        username: "24d95e537cd2acc083268cdb",
        credential: "O9Mo4JnvwlmyxXJA",
      },
      {
        urls: "turns:global.relay.metered.ca:443?transport=tcp",
        username: "24d95e537cd2acc083268cdb",
        credential: "O9Mo4JnvwlmyxXJA",
      },
    ],
};

async function join() {
    // Check for media permissions/HTTPS context
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Warning: Media devices are not accessible. This usually happens when not using HTTPS or if permissions are blocked. You may be able to chat but video/audio calls will fail.');
    }

    myUsername = document.getElementById('username').value.trim();
    const roomName = document.getElementById('room').value.trim();

    if (!myUsername) {
        showToast('Please enter a username');
        return;
    }
    if (!roomName) {
        showToast('Please enter a room name');
        return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    ws = new WebSocket(`${protocol}//${host}/ws?username=${encodeURIComponent(myUsername)}&room=${encodeURIComponent(roomName)}`);

    ws.onopen = async () => {
        document.getElementById('login').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        document.getElementById('myUsername').textContent = `${myUsername} (Room: ${roomName})`;
    };

    ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'connected') {
            myId = msg.from;  // El servidor ens envia el nostre ID
            console.log('Connectat amb ID:', myId);
        } else if (msg.type === 'user-list') {
            updateUserList(msg.users);
        } else if (msg.type === 'system') {
            showToast(msg.content);
        } else {
            await handleSignaling(msg);
        }
    };

    ws.onclose = () => {
        showToast('Disconnected from server');
    };
}

function showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.5s ease';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

// Emmagatzemar la llista d'usuaris actual globalment
let currentUsers = [];

function updateUserList(users) {
    // Si es proporcionen usuaris, actualitzar la llista emmagatzemada
    if (users && users.length > 0) {
        currentUsers = users;
    }
    
    const userList = document.getElementById('userList');
    userList.innerHTML = '';
    
    currentUsers.forEach(user => {
        const item = document.createElement('div');
        item.className = 'user-item';
        if (user.id === myId) {
            item.classList.add('self');
        }
        if (user.id === selectedUserId) {
            item.classList.add('active');
        }
        
        const avatar = user.username.charAt(0).toUpperCase();
        
        // Mostrar insígnia de no llegits
        const unreadBadge = unreadCounts[user.id] > 0 
            ? `<span class="unread-badge">${unreadCounts[user.id]}</span>` 
            : '';
        
        item.innerHTML = `
            <div class="user-avatar">${avatar}</div>
            <div class="user-info">
                <div class="user-name">${user.username} ${user.id === myId ? '(You)' : ''}</div>
                <div class="user-status">● Online</div>
            </div>
            ${unreadBadge}
        `;
        
        if (user.id !== myId) {
            item.onclick = () => selectUser(user.id, user.username);
        }
        
        userList.appendChild(item);
    });
}

function selectUser(userId, username) {
    selectedUserId = userId;
    selectedUsername = username;
    
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('chatView').classList.remove('hidden');
    document.getElementById('chatUsername').textContent = username;
    
    // Mobile: Slide in main content
    document.querySelector('.main-content').classList.add('active');
    
    // Carregar historial de missatges
    loadMessageHistory(userId);
    
    // Netejar recompte de no llegits per a aquest usuari
    unreadCounts[userId] = 0;
    
    // Actualitzar estat actiu
    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.remove('active');
    });
    // Trobar i activar l'element d'usuari correcte
    const userItems = document.querySelectorAll('.user-item');
    userItems.forEach(item => {
        const nameDiv = item.querySelector('.user-name');
        if (nameDiv && nameDiv.textContent.includes(username)) {
            item.classList.add('active');
        }
    });
    
    // Re-renderitzar llista d'usuaris per eliminar insígnia
    updateUserList();
    
    // Actualitzar estat de connexió
    updateConnectionStatus(userId);
    
    // Establir connexió P2P si no existeix
    if (!peerConnections[userId]) {
        initiatePeerConnection(userId);
    }
}

function goBack() {
    // Mobile: Slide out main content
    document.querySelector('.main-content').classList.remove('active');
    
    // Deselect user after animation
    setTimeout(() => {
        selectedUserId = null;
        selectedUsername = null;
        document.querySelectorAll('.user-item').forEach(item => item.classList.remove('active'));
        
        // Reset views to empty state
        document.getElementById('chatView').classList.add('hidden');
        document.getElementById('callView').classList.add('hidden'); // Ensure call view is hidden too
        document.getElementById('emptyState').classList.remove('hidden');
    }, 300);
}

async function checkSelectedCandidate(pc, peerId) {
    const stats = await pc.getStats();
    
    stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            console.log(`✅ Connexió activa amb ${peerId}:`, report);
        }
    });
}

async function updateConnectionStatus(userId) {
    const peerConn = peerConnections[userId];
    const statusDiv = document.getElementById('chatUsername');
    
    if (!peerConn || !peerConn.dataChannel) {
        statusDiv.innerHTML = `${selectedUsername} <span style="color: #f39c12; font-size: 12px;">● Connecting...</span>`;
    } else if (peerConn.dataChannel.readyState === 'open') {
        // Comprovar tipus de connexió
        const connectionType = await getConnectionType(peerConn.pc);
        const typeEmoji = connectionType === 'relay' ? '🔄' : '⚡';
        const typeText = connectionType === 'relay' ? 'TURN Relay' : 'P2P Direct';
        
        statusDiv.innerHTML = `${selectedUsername} <span style="color: #27ae60; font-size: 12px;">● Connected ${typeEmoji} ${typeText}</span>`;
    } else {
        statusDiv.innerHTML = `${selectedUsername} <span style="color: #f39c12; font-size: 12px;">● Connecting...</span>`;
    }
}

async function getConnectionType(pc) {
    const stats = await pc.getStats();
    let connectionType = 'unknown';
    
    stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            // Obtenir l'ID del candidat local del parell
            const localCandidateId = report.localCandidateId;
            
            // Trobar els detalls del candidat local
            stats.forEach(candidate => {
                if (candidate.id === localCandidateId && candidate.type === 'local-candidate') {
                    connectionType = candidate.candidateType; // 'host', 'srflx', o 'relay'
                }
            });
        }
    });
    
    return connectionType;
}

// Carregar historial de missatges
function loadMessageHistory(userId) {
    const messagesContainer = document.getElementById('messages');
    messagesContainer.innerHTML = '';
    
    // Inicialitzar array d'historial si no existeix
    if (!messageHistory[userId]) {
        messageHistory[userId] = [];
    }
    
    // Mostrar tots els missatges emmagatzemats per a aquest usuari
    messageHistory[userId].forEach(msg => {
        if (msg.isFile) {
            displayMessageInDOM(msg.text, msg.isSent, msg.timestamp, true, msg.fileUrl, msg.filename);
        } else {
            displayMessageInDOM(msg.text, msg.isSent, msg.timestamp, false);
        }
    });
}

async function initiatePeerConnection(userId) {
    const pc = createPeerConnection(userId, false);
    peerConnections[userId] = { pc };
    
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: 'offer', to: userId, data: offer });
}

function createPeerConnection(peerId, includeVideo = false) {
    const pc = new RTCPeerConnection(config);

    pc.onconnectionstatechange = () => {
        console.log(`Estat de connexió amb ${peerId}:`, pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`Estat de connexió ICE amb ${peerId}:`, pc.iceConnectionState);
    };

    // NOU: Comprovar quin parell de candidats s'està utilitzant realment
    pc.onicecandidate = async (event) => {
        if (event.candidate) {
            send({ type: 'ice-candidate', to: peerId, data: event.candidate });
        } else {
            // Tots els candidats recopilats, comprovar quin està seleccionat
            console.log('Recopilació ICE completa');
            setTimeout(() => checkSelectedCandidate(pc, peerId), 2000);
        }
    };

    const dataChannel = pc.createDataChannel("chat");
    setupDataChannel(dataChannel, peerId);
    
    if (!peerConnections[peerId]) {
        peerConnections[peerId] = {};
    }
    peerConnections[peerId].dataChannel = dataChannel;

    // Gestionar pistes de vídeo/àudio si existeixen
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }

    pc.ontrack = (event) => {
        document.getElementById('remoteVideo').srcObject = event.streams[0];
    };

    pc.ondatachannel = (event) => {
        setupDataChannel(event.channel, peerId);
        if (!peerConnections[peerId]) {
            peerConnections[peerId] = {};
        }
        peerConnections[peerId].dataChannel = event.channel;
    };

    return pc;
}

function setupDataChannel(dataChannel, peerId) {
    dataChannel.onopen = () => {
        console.log('Data channel opened with', peerId);
        // Update UI if this is the currently selected user
        if (selectedUserId === peerId) {
            updateConnectionStatus(peerId);
        }
    };

    dataChannel.onclose = () => {
        console.log('Data channel closed with', peerId);
        if (selectedUserId === peerId) {
            updateConnectionStatus(peerId);
        }
    };

    dataChannel.onmessage = (event) => {
        if (typeof event.data === 'string') {
            const msg = JSON.parse(event.data);
            
            if (msg.type === 'text') {
                // Store and display message (even if chat not open)
                storeMessage(peerId, msg.data, false);
                
                // Only display if currently viewing this chat
                if (selectedUserId === peerId) {
                    displayMessageInDOM(msg.data, false, new Date());
                } else {
                    // Increment unread count
                    unreadCounts[peerId] = (unreadCounts[peerId] || 0) + 1;
                    updateUserList(); // Refresh to show badge
                }
            } else if (msg.type === 'ping') {
                // Respond with pong
                dataChannel.send(JSON.stringify({
                    type: 'pong',
                    timestamp: msg.timestamp
                }));
            } else if (msg.type === 'pong') {
                // Calculate latency
                const latency = Date.now() - msg.timestamp;
                showToast(`P2P Latency: ${latency}ms ⚡`);
                
                // Also show in chat as a system message
                if (selectedUserId === peerId) {
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
                incomingFile = msg;
                incomingFileFrom = peerId;
                fileChunks = [];
            } else if (msg.type === 'file-end') {
                const blob = new Blob(fileChunks);
                const url = URL.createObjectURL(blob);
                
                // Store file message
                storeMessage(incomingFileFrom, `📎 ${incomingFile.name}`, false, true, url, incomingFile.name);
                
                if (selectedUserId === incomingFileFrom) {
                    displayMessageInDOM(`📎 ${incomingFile.name}`, false, new Date(), true, url, incomingFile.name);
                } else {
                    unreadCounts[incomingFileFrom] = (unreadCounts[incomingFileFrom] || 0) + 1;
                    updateUserList();
                }
                
                incomingFile = null;
                incomingFileFrom = null;
                fileChunks = [];
            }
        } else {
            fileChunks.push(event.data);
        }
    };

    dataChannel.onerror = (error) => {
        console.error('Data channel error:', error);
    };
}

// Store message in history
function storeMessage(userId, text, isSent, isFile = false, fileUrl = null, filename = null) {
    if (!messageHistory[userId]) {
        messageHistory[userId] = [];
    }
    
    messageHistory[userId].push({
        text,
        isSent,
        timestamp: new Date(),
        isFile,
        fileUrl,
        filename
    });
}

// Display message in DOM (separate from storing)
function displayMessageInDOM(text, isSent, timestamp, isFile = false, fileUrl = null, filename = null) {
    const messages = document.getElementById('messages');
    const msg = document.createElement('div');
    msg.className = `message ${isSent ? 'sent' : 'received'}`;
    
    const time = timestamp instanceof Date 
        ? timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : timestamp;
    
    if (isFile) {
        msg.innerHTML = `
            <div>📎 <a href="${fileUrl}" download="${filename}">${filename}</a></div>
            <div class="message-time">${time}</div>
        `;
    } else {
        msg.innerHTML = `
            <div>${text}</div>
            <div class="message-time">${time}</div>
        `;
    }
    
    messages.appendChild(msg);
    messages.scrollTop = messages.scrollHeight;
}

function sendMessage() {
    const input = document.getElementById('messageBox');
    const text = input.value.trim();
    if (!text || !selectedUserId) return;
    
    const peerConn = peerConnections[selectedUserId];
    if (peerConn && peerConn.dataChannel && peerConn.dataChannel.readyState === 'open') {
        peerConn.dataChannel.send(JSON.stringify({ type: 'text', data: text }));
        
        // Store and display
        storeMessage(selectedUserId, text, true);
        displayMessageInDOM(text, true, new Date());
        
        input.value = '';
    } else {
        // Show message in UI instead of alert
        const statusDiv = document.getElementById('chatUsername');
        statusDiv.innerHTML = `${selectedUsername} <span style="color: #e74c3c; font-size: 12px;">● Not connected - please wait</span>`;
        setTimeout(() => updateConnectionStatus(selectedUserId), 2000);
    }
}

function handleEnter(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

function sendPing() {
    if (!selectedUserId || !peerConnections[selectedUserId]) return;
    
    const dc = peerConnections[selectedUserId].dataChannel;
    if (dc && dc.readyState === 'open') {
        const timestamp = Date.now();
        dc.send(JSON.stringify({
            type: 'ping',
            timestamp: timestamp
        }));
        showToast('Ping sent... ⚡');
    } else {
        showToast('P2P Data Channel not ready');
    }
}

function sendFile() {
    document.getElementById('fileInput').click();
}

async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file || !selectedUserId) return;
    
    const peerConn = peerConnections[selectedUserId];
    if (!peerConn || !peerConn.dataChannel || peerConn.dataChannel.readyState !== 'open') {
        showToast('Connection not ready');
        return;
    }
    
    const dataChannel = peerConn.dataChannel;
    
    dataChannel.send(JSON.stringify({
        type: 'file-start',
        name: file.name,
        size: file.size,
        mimeType: file.type
    }));
    
    const chunkSize = 16384;
    let offset = 0;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        dataChannel.send(e.target.result);
        offset += chunkSize;
        
        if (offset < file.size) {
            readSlice(offset);
        } else {
            dataChannel.send(JSON.stringify({ type: 'file-end' }));
            const url = URL.createObjectURL(file);
            
            // Store and display
            storeMessage(selectedUserId, `📎 ${file.name}`, true, true, url, file.name);
            displayMessageInDOM(`📎 ${file.name}`, true, new Date(), true, url, file.name);
        }
    };
    
    const readSlice = (o) => {
        const slice = file.slice(o, o + chunkSize);
        reader.readAsArrayBuffer(slice);
    };
    
    readSlice(0);
    
    // Reset file input
    event.target.value = '';
}

async function startCall(videoEnabled = false) {
    if (!selectedUserId) return;

    // Sol·licitar micròfon i càmera aquí, només quan comença la trucada
    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: videoEnabled,
                audio: true
            });
        } catch (err) {
            console.error("Error accedint als dispositius:", err);
            showToast('Microphone/Camera access denied or unavailable. Please check browser permissions and ensure you are using HTTPS.');
            return;
        }
    }

    const peerConn = peerConnections[selectedUserId];
    if (!peerConn || !peerConn.pc) {
        showToast('Connection not established');
        return;
    }

    document.getElementById('chatView').classList.add('hidden');
    document.getElementById('callView').classList.remove('hidden');
    document.getElementById('callUsername').textContent = selectedUsername;
    document.getElementById('localVideo').srcObject = localStream;
    
    // Mostrar/amagar vídeo local segons el tipus de trucada
    document.getElementById('localVideo').style.display = videoEnabled ? 'block' : 'none';

    // Afegir pistes a la connexió
    localStream.getTracks().forEach(track => {
        peerConn.pc.addTrack(track, localStream);
    });

    peerConn.pc.ontrack = (event) => {
        document.getElementById('remoteVideo').srcObject = event.streams[0];
    };

    const offer = await peerConn.pc.createOffer();
    await peerConn.pc.setLocalDescription(offer);
    send({ type: 'offer', to: selectedUserId, data: offer });

    // Iniciar monitorització d'estadístiques P2P
    startStatsMonitoring(peerConn.pc);
}

let statsInterval;

function startStatsMonitoring(pc) {
    if (statsInterval) clearInterval(statsInterval);
    
    statsInterval = setInterval(async () => {
        if (!pc) return;
        
        const stats = await pc.getStats();
        let activeCandidatePair = null;
        let bitrate = 0;

        stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                activeCandidatePair = report;
            }
            if (report.type === 'inbound-rtp' && report.kind === 'video') {
                // Calcular bitrate aproximat (bytes rebuts)
                // Això és una simplificació, per fer-ho bé caldria comparar amb l'anterior
            }
        });

        if (activeCandidatePair) {
            // Obtenir tipus de candidat local i remot
            // Això demostra que és P2P si el tipus és 'host' o 'srflx'
            document.getElementById('connStatus').textContent = 'Connected (Encrypted)';
            document.getElementById('connStatus').style.color = '#00ff00';
            
            // Intentar esbrinar el tipus (local vs relay)
            // Necessitem buscar els candidats associats al parell
            const localCand = stats.get(activeCandidatePair.localCandidateId);
            const remoteCand = stats.get(activeCandidatePair.remoteCandidateId);
            
            if (localCand && remoteCand) {
                const type = localCand.candidateType === 'relay' || remoteCand.candidateType === 'relay' 
                    ? 'TURN Relay (Server)' 
                    : 'P2P Direct (Local/STUN)';
                
                document.getElementById('connType').textContent = `${type}`;
                document.getElementById('connType').title = `Local: ${localCand.ip}:${localCand.port} <-> Remote: ${remoteCand.ip}:${remoteCand.port}`;
            }
        }
    }, 1000);
}

function toggleAudio() {
    if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            document.getElementById('audioBtn').classList.toggle('muted');
        }
    }
}

function toggleVideo() {
    if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            document.getElementById('videoBtn').classList.toggle('muted');
        }
    }
}

async function handleSignaling(msg) {
    let peerConn = peerConnections[msg.from];
    
    if (msg.type === 'offer') {
        // Si rebem una oferta, pot ser una trucada entrant
        // Hauríem de preguntar a l'usuari si vol acceptar, però per ara acceptem automàticament
        // i mostrem la vista de trucada si hi ha pistes de vídeo/àudio
        
        if (!peerConn) {
            const pc = createPeerConnection(msg.from, false);
            peerConnections[msg.from] = { pc };
            peerConn = peerConnections[msg.from];
        }
        
        await peerConn.pc.setRemoteDescription(new RTCSessionDescription(msg.data));
        
        // Si és una trucada (té pistes remotes), preparem la nostra resposta
        // Nota: En una app real, aquí sonaria el telèfon
        
        // Per respondre, necessitem el nostre stream si volem parlar
        if (!localStream) {
             try {
                // Per defecte responem amb àudio, vídeo si l'oferta en té? 
                // Simplificació: responem amb el que puguem (àudio mínim)
                localStream = await navigator.mediaDevices.getUserMedia({
                    video: true, // Intentem vídeo també
                    audio: true
                });
                
                document.getElementById('localVideo').srcObject = localStream;
                
                localStream.getTracks().forEach(track => {
                    peerConn.pc.addTrack(track, localStream);
                });
            } catch (e) {
                console.log("No s'ha pogut obtenir mitjans locals per respondre", e);
            }
        }

        const answer = await peerConn.pc.createAnswer();
        await peerConn.pc.setLocalDescription(answer);
        send({ type: 'answer', to: msg.from, data: answer });
        
        // Mostrar vista de trucada si estem en aquesta conversa
        if (selectedUserId === msg.from) {
             document.getElementById('chatView').classList.add('hidden');
             document.getElementById('callView').classList.remove('hidden');
             document.getElementById('callUsername').textContent = selectedUsername;
        }
        
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

function endCall(notifyPeer = true) {
    if (statsInterval) clearInterval(statsInterval);
    
    if (selectedUserId) {
        if (notifyPeer) {
            send({ type: 'end-call', to: selectedUserId });
        }

        if (peerConnections[selectedUserId]) {
            const peerConn = peerConnections[selectedUserId];
            
            if (peerConn.pc) {
                const senders = peerConn.pc.getSenders();
                senders.forEach(sender => {
                    if (sender.track) {
                        peerConn.pc.removeTrack(sender);
                    }
                });
                peerConn.pc.close(); // Close the connection properly
                delete peerConnections[selectedUserId]; // Remove from map
            }
        }
    }

    // ATURAR el micròfon i càmera
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    document.getElementById('remoteVideo').srcObject = null;
    document.getElementById('localVideo').srcObject = null;
    document.getElementById('callView').classList.add('hidden');
    document.getElementById('chatView').classList.remove('hidden');
    
    // Reset botons
    const audioBtn = document.getElementById('audioBtn');
    const videoBtn = document.getElementById('videoBtn');
    if (audioBtn) {
        audioBtn.classList.remove('muted');
        audioBtn.textContent = '🎤';
    }
    if (videoBtn) {
        videoBtn.classList.remove('muted');
        videoBtn.textContent = '📷';
    }
}

function send(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}