import { state } from './state.js';
import { initiatePeerConnection, getConnectionType } from './webrtc.js';

export function showToast(message) {
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

export function updateUserList(users) {
    if (users && users.length > 0) {
        state.currentUsers = users;
    }
    
    const userList = document.getElementById('userList');
    userList.innerHTML = '';
    
    state.currentUsers.forEach(user => {
        const item = document.createElement('div');
        item.className = 'user-item';
        if (user.id === state.myId) {
            item.classList.add('self');
        }
        if (user.id === state.selectedUserId) {
            item.classList.add('active');
        }
        
        const avatar = user.username.charAt(0).toUpperCase();
        
        const unreadBadge = state.unreadCounts[user.id] > 0 
            ? `<span class="unread-badge">${state.unreadCounts[user.id]}</span>` 
            : '';
        
        item.innerHTML = `
            <div class="user-avatar">${avatar}</div>
            <div class="user-info">
                <div class="user-name">${user.username} ${user.id === state.myId ? '(You)' : ''}</div>
                <div class="user-status">● Online</div>
            </div>
            ${unreadBadge}
        `;
        
        if (user.id !== state.myId) {
            item.onclick = () => selectUser(user.id, user.username);
        }
        
        userList.appendChild(item);
    });
}

export function selectUser(userId, username) {
    state.selectedUserId = userId;
    state.selectedUsername = username;
    
    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('chatView').classList.remove('hidden');
    document.getElementById('chatUsername').textContent = username;
    
    document.querySelector('.main-content').classList.add('active');
    
    loadMessageHistory(userId);
    
    state.unreadCounts[userId] = 0;
    
    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.remove('active');
    });
    
    const userItems = document.querySelectorAll('.user-item');
    userItems.forEach(item => {
        const nameDiv = item.querySelector('.user-name');
        if (nameDiv && nameDiv.textContent.includes(username)) {
            item.classList.add('active');
        }
    });
    
    updateUserList();
    updateConnectionStatus(userId);
    
    if (!state.peerConnections[userId]) {
        initiatePeerConnection(userId);
    }
}

export function goBack() {
    document.querySelector('.main-content').classList.remove('active');
    
    setTimeout(() => {
        state.selectedUserId = null;
        state.selectedUsername = null;
        document.querySelectorAll('.user-item').forEach(item => item.classList.remove('active'));
        
        document.getElementById('chatView').classList.add('hidden');
        document.getElementById('callView').classList.add('hidden');
        document.getElementById('emptyState').classList.remove('hidden');
    }, 300);
}

export async function updateConnectionStatus(userId) {
    const peerConn = state.peerConnections[userId];
    const statusDiv = document.getElementById('chatUsername');
    
    if (!peerConn || !peerConn.dataChannel) {
        statusDiv.innerHTML = `${state.selectedUsername} <span style="color: #f39c12; font-size: 12px;">● Connecting...</span>`;
    } else if (peerConn.dataChannel.readyState === 'open') {
        const connectionType = await getConnectionType(peerConn.pc);
        const typeEmoji = connectionType === 'relay' ? '🔄' : '⚡';
        const typeText = connectionType === 'relay' ? 'TURN Relay' : 'P2P Direct';
        
        statusDiv.innerHTML = `${state.selectedUsername} <span style="color: #27ae60; font-size: 12px;">● Connected ${typeEmoji} ${typeText}</span>`;
    } else {
        statusDiv.innerHTML = `${state.selectedUsername} <span style="color: #f39c12; font-size: 12px;">● Connecting...</span>`;
    }
}

export function loadMessageHistory(userId) {
    const messagesContainer = document.getElementById('messages');
    messagesContainer.innerHTML = '';
    
    if (!state.messageHistory[userId]) {
        state.messageHistory[userId] = [];
    }
    
    state.messageHistory[userId].forEach(msg => {
        if (msg.isFile) {
            displayMessageInDOM(msg.text, msg.isSent, msg.timestamp, true, msg.fileUrl, msg.filename);
        } else {
            displayMessageInDOM(msg.text, msg.isSent, msg.timestamp, false);
        }
    });
}

export function displayMessageInDOM(text, isSent, timestamp, isFile = false, fileUrl = null, filename = null) {
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

export function storeMessage(userId, text, isSent, isFile = false, fileUrl = null, filename = null) {
    if (!state.messageHistory[userId]) {
        state.messageHistory[userId] = [];
    }
    
    state.messageHistory[userId].push({
        text,
        isSent,
        timestamp: new Date(),
        isFile,
        fileUrl,
        filename
    });
}
