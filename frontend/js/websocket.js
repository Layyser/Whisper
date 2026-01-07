// Gestiona la conexion WebSocket para la senalizacion
import { state } from './state.js';
import { showToast, updateUserList } from './ui.js';
import { handleSignaling } from './webrtc.js';
import { backendConfig } from './config.js';

export function join() {
    // Avisamos si no hay acceso a media (suele ser por falta de HTTPS)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showToast('Warning: Media devices are not accessible. This usually happens when not using HTTPS or if permissions are blocked. You may be able to chat but video/audio calls will fail.');
    }

    state.myUsername = document.getElementById('username').value.trim();
    const roomName = document.getElementById('room').value.trim();
    const password = document.getElementById('password').value.trim();

    if (!state.myUsername) {
        showToast('Please enter a username');
        return;
    }
    if (!roomName) {
        showToast('Please enter a room name');
        return;
    }

    // Construimos la URL WS segun config o el host actual
    let wsUrl;
    if (backendConfig.url) {
        // Usa el endpoint configurado (ej: dominio publico)
        wsUrl = `${backendConfig.url}?username=${encodeURIComponent(state.myUsername)}&room=${encodeURIComponent(roomName)}&password=${encodeURIComponent(password)}`;
    } else {
        // Por defecto usa el mismo host donde se sirve el frontend
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        wsUrl = `${protocol}//${host}/ws?username=${encodeURIComponent(state.myUsername)}&room=${encodeURIComponent(roomName)}&password=${encodeURIComponent(password)}`;
    }

    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = async () => {
        // Mostrar la app y guardar la info del usuario/sala
        document.getElementById('login').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        document.getElementById('myUsername').textContent = `${state.myUsername} (Room: ${roomName})`;
        
        if (!window.isSecureContext) {
            showToast('Warning: Not in a Secure Context. Camera/Mic might fail.');
        }
    };

    // Despachamos los mensajes entrantes del servidor
    state.ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'error') {
            showToast(msg.content);
            document.getElementById('login').classList.remove('hidden');
            document.getElementById('app').classList.add('hidden');
        } else if (msg.type === 'connected') {
            state.myId = msg.from;
            console.log('Connectat amb ID:', state.myId);
        } else if (msg.type === 'user-list') {
            updateUserList(msg.users);
        } else if (msg.type === 'system') {
            showToast(msg.content);
        } else {
            await handleSignaling(msg);
        }
    };

    state.ws.onclose = () => {
        showToast('Disconnected from server');
    };
}

export function send(message) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(message));
    }
}
