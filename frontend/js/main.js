import { join } from './websocket.js';
import { goBack, selectUser } from './ui.js';
import { requestCall, acceptCall, rejectCall, toggleAudio, toggleVideo, endCall, sendPing, sendFile } from './webrtc.js';
import { state } from './state.js';

// Expose functions to global scope for HTML onclick handlers
window.join = join;
window.goBack = goBack;
window.requestCall = requestCall;
window.acceptCall = acceptCall;
window.rejectCall = rejectCall;
window.toggleAudio = toggleAudio;
window.toggleVideo = toggleVideo;
window.endCall = endCall;
window.sendPing = sendPing;
window.sendFile = sendFile;

// Handle file input
window.handleFileSelect = async (event) => {
    const file = event.target.files[0];
    if (!file || !state.selectedUserId) return;
    
    const peerConn = state.peerConnections[state.selectedUserId];
    if (!peerConn || !peerConn.dataChannel || peerConn.dataChannel.readyState !== 'open') {
        // showToast('Connection not ready'); // Need to import showToast or expose it
        console.error('Connection not ready');
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
            
            // Need to import storeMessage/displayMessageInDOM or expose them
            // For now, let's assume the data channel message handler on the other side handles it
            // But we need to show it locally too.
            // This part needs refactoring to be cleaner, but for now:
            import('./ui.js').then(ui => {
                ui.storeMessage(state.selectedUserId, `📎 ${file.name}`, true, true, url, file.name);
                ui.displayMessageInDOM(`📎 ${file.name}`, true, new Date(), true, url, file.name);
            });
        }
    };
    
    const readSlice = (o) => {
        const slice = file.slice(o, o + chunkSize);
        reader.readAsArrayBuffer(slice);
    };
    
    readSlice(0);
    event.target.value = '';
};

window.sendMessage = () => {
    const input = document.getElementById('messageBox');
    const text = input.value.trim();
    if (!text || !state.selectedUserId) return;
    
    const peerConn = state.peerConnections[state.selectedUserId];
    if (peerConn && peerConn.dataChannel && peerConn.dataChannel.readyState === 'open') {
        peerConn.dataChannel.send(JSON.stringify({ type: 'text', data: text }));
        
        import('./ui.js').then(ui => {
            ui.storeMessage(state.selectedUserId, text, true);
            ui.displayMessageInDOM(text, true, new Date());
        });
        
        input.value = '';
    } else {
        const statusDiv = document.getElementById('chatUsername');
        statusDiv.innerHTML = `${state.selectedUsername} <span style="color: #e74c3c; font-size: 12px;">● Not connected - please wait</span>`;
        import('./ui.js').then(ui => {
            setTimeout(() => ui.updateConnectionStatus(state.selectedUserId), 2000);
        });
    }
};

window.handleEnter = (event) => {
    if (event.key === 'Enter') {
        window.sendMessage();
    }
};
