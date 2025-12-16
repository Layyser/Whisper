let ws;
let myId;
let myUsername;
let peerConnections = {}; // { userId: { pc, dataChannel, ... } }
let incomingCall = {}; // { userId: true/false }
let localStream;
let selectedUserId;
let selectedUsername;

// Store message history per user
let messageHistory = {}; // { userId: [ {text, isSent, timestamp, isFile, fileUrl}, ... ] }
let unreadCounts = {};   // { userId: number }

// File receiving state
let incomingFile = null;
let fileChunks = [];
let incomingFileFrom = null; // Track who is sending the file

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
    myUsername = document.getElementById('username').value.trim();
    if (!myUsername) {
        alert('Please enter a username');
        return;
    }

    ws = new WebSocket(`wss://myrtle-grow-appliances-creature.trycloudflare.com/ws?username=${myUsername}`);

    ws.onopen = async () => {
        document.getElementById('login').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        document.getElementById('myUsername').textContent = myUsername;
    };

    ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'connected') {
            myId = msg.from;  // Server sends us our ID
            console.log('Connected with ID:', myId);
        } else if (msg.type === 'user-list') {
            updateUserList(msg.users);
        } else {
            await handleSignaling(msg);
        }
    };

    ws.onclose = () => {
        alert('Disconnected from server');
    };
}

// Store the current user list globally
let currentUsers = [];

function updateUserList(users) {
    // If users is provided, update the stored list
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
        
        // Show unread badge
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
    
    // Mobile: hide sidebar, show chat
    if (window.innerWidth < 768) {
        document.querySelector('.sidebar').classList.add('mobile-hidden');
        document.querySelector('.main-content').classList.add('mobile-full');
    }
    
    // Load message history
    loadMessageHistory(userId);
    
    // Clear unread count for this user
    unreadCounts[userId] = 0;
    
    // Update active state - FIX: Remove event reference bug
    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.remove('active');
    });
    // Find and activate the correct user item
    const userItems = document.querySelectorAll('.user-item');
    userItems.forEach(item => {
        const nameDiv = item.querySelector('.user-name');
        if (nameDiv && nameDiv.textContent.includes(username)) {
            item.classList.add('active');
        }
    });
    
    // Re-render user list to remove badge
    updateUserList();
    
    // Update connection status
    updateConnectionStatus(userId);
    
    // Establish P2P connection if not exists
    if (!peerConnections[userId]) {
        initiatePeerConnection(userId);
    }
}

function goBack() {
    // Mobile: show sidebar, hide chat
    if (window.innerWidth < 768) {
        document.querySelector('.sidebar').classList.remove('mobile-hidden');
        document.querySelector('.main-content').classList.remove('mobile-full');
        document.getElementById('chatView').classList.add('hidden');
        document.getElementById('emptyState').classList.remove('hidden');
    }
}

async function checkSelectedCandidate(pc, peerId) {
    const stats = await pc.getStats();
    
    stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            console.log(`✅ Active connection with ${peerId}:`, report);
        }
        
        if (report.type === 'local-candidate') {
            console.log(`Local candidate:`, {
                type: report.candidateType,
                protocol: report.protocol,
                address: report.address || report.ip,
                port: report.port
            });
        }
        
        if (report.type === 'remote-candidate') {
            console.log(`Remote candidate:`, {
                type: report.candidateType,
                protocol: report.protocol,
                address: report.address || report.ip,
                port: report.port
            });
        }
    });
}

async function updateConnectionStatus(userId) {
    const peerConn = peerConnections[userId];
    const statusDiv = document.getElementById('chatUsername');
    
    if (!peerConn || !peerConn.dataChannel) {
        statusDiv.innerHTML = `${selectedUsername} <span style="color: #f39c12; font-size: 12px;">● Connecting...</span>`;
    } else if (peerConn.dataChannel.readyState === 'open') {
        // Check connection type
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
            // Get the local candidate ID from the pair
            const localCandidateId = report.localCandidateId;
            
            // Find the local candidate details
            stats.forEach(candidate => {
                if (candidate.id === localCandidateId && candidate.type === 'local-candidate') {
                    connectionType = candidate.candidateType; // 'host', 'srflx', or 'relay'
                }
            });
        }
    });
    
    return connectionType;
}

// Load message history
function loadMessageHistory(userId) {
    const messagesContainer = document.getElementById('messages');
    messagesContainer.innerHTML = '';
    
    // Initialize history array if doesn't exist
    if (!messageHistory[userId]) {
        messageHistory[userId] = [];
    }
    
    // Display all stored messages for this user
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
        console.log(`Connection state with ${peerId}:`, pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
        console.log(`ICE connection state with ${peerId}:`, pc.iceConnectionState);
    };

    // NEW: Check which candidate pair is actually being used
    pc.onicecandidate = async (event) => {
        if (event.candidate) {
            console.log('ICE Candidate:', {
                type: event.candidate.type,
                protocol: event.candidate.protocol,
                address: event.candidate.address,
                port: event.candidate.port,
                candidate: event.candidate.candidate
            });
            send({ type: 'ice-candidate', to: peerId, data: event.candidate });
        } else {
            // All candidates gathered, check which one is selected
            console.log('ICE gathering complete');
            setTimeout(() => checkSelectedCandidate(pc, peerId), 2000);
        }
    };

    const dataChannel = pc.createDataChannel("chat");
    setupDataChannel(dataChannel, peerId);
    
    if (!peerConnections[peerId]) {
        peerConnections[peerId] = {};
    }
    peerConnections[peerId].dataChannel = dataChannel;

    if (includeVideo && localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });

        pc.ontrack = (event) => {
            document.getElementById('remoteVideo').srcObject = event.streams[0];
        };
    }

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log('ICE Candidate Type:', event.candidate.type);
            console.log('Full candidate:', event.candidate.candidate);
            send({ type: 'ice-candidate', to: peerId, data: event.candidate });
        }
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

function sendFile() {
    document.getElementById('fileInput').click();
}

async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file || !selectedUserId) return;
    
    const peerConn = peerConnections[selectedUserId];
    if (!peerConn || !peerConn.dataChannel || peerConn.dataChannel.readyState !== 'open') {
        alert('Connection not ready');
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

async function startCall() {
    if (!selectedUserId) return;

    // Request mic here, only when call starts
    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: false,
                audio: true
            });
        } catch (err) {
            alert('Microphone access denied');
            return;
        }
    }

    const peerConn = peerConnections[selectedUserId];
    if (!peerConn || !peerConn.pc) {
        alert('Connection not established');
        return;
    }

    document.getElementById('chatView').classList.add('hidden');
    document.getElementById('callView').classList.remove('hidden');
    document.getElementById('callUsername').textContent = selectedUsername;
    document.getElementById('localVideo').srcObject = localStream;

    localStream.getTracks().forEach(track => {
        peerConn.pc.addTrack(track, localStream);
    });

    peerConn.pc.ontrack = (event) => {
        document.getElementById('remoteVideo').srcObject = event.streams[0];
    };

    const offer = await peerConn.pc.createOffer();
    await peerConn.pc.setLocalDescription(offer);
    send({ type: 'offer', to: selectedUserId, data: offer });
}

async function handleSignaling(msg) {
    let peerConn = peerConnections[msg.from];
    
    if (msg.type === 'offer') {
        if (!peerConn) {
            const pc = createPeerConnection(msg.from, false);
            peerConnections[msg.from] = { pc };
            peerConn = peerConnections[msg.from];
        }
        
        await peerConn.pc.setRemoteDescription(new RTCSessionDescription(msg.data));
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
    }
}

function endCall() {
    if (selectedUserId && peerConnections[selectedUserId]) {
        const peerConn = peerConnections[selectedUserId];
        
        if (peerConn.pc) {
            const senders = peerConn.pc.getSenders();
            senders.forEach(sender => {
                if (sender.track) {
                    peerConn.pc.removeTrack(sender);
                }
            });
        }
    }

    // STOP the mic
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    document.getElementById('remoteVideo').srcObject = null;
    document.getElementById('callView').classList.add('hidden');
    document.getElementById('chatView').classList.remove('hidden');
}

function send(message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}