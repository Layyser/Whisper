# Whisper 🤫
> A secure, private, and direct P2P video and chat application.

Whisper is a real-time communication platform designed to demonstrate the power of **WebRTC** and **Peer-to-Peer (P2P)** technologies. It allows users to chat, share files, and make audio/video calls directly between devices without the data passing through a central server (except for signaling).


## 🚀 Features

-   **Real-time Chat:** Instant messaging with delivery status.
-   **P2P Video & Audio Calls:** High-quality calls connecting directly between users.
-   **File Sharing:** Send files of any size directly peer-to-peer.
-   **End-to-End Encryption:** All media and data are encrypted by WebRTC standards.
-   **Latency Ping:** Verify your direct connection speed with the built-in P2P Ping tool.
-   **Connection Stats:** Real-time monitoring of connection type (P2P/Relay) and bitrate.
-   **Mobile Responsive:** Professional UI that adapts to phones, tablets, and desktops.
-   **Dockerized:** Easy deployment with Docker Compose.

---

## 🛠️ Technology Stack

### Backend (Signaling Server)
-   **Language:** Go (Golang) 1.23
-   **Library:** `gorilla/websocket`
-   **Role:** The server acts **only** as a matchmaker. It helps two peers find each other by exchanging "Signaling" data (SDP and ICE candidates). Once connected, the server is not involved in the media or data transfer.
-   **Security:** Supports TLS/SSL (HTTPS/WSS) for secure signaling.

### Frontend (Client)
-   **Core:** Vanilla JavaScript (ES6+), HTML5, CSS3.
-   **Protocol:** **WebRTC** (RTCPeerConnection, RTCDataChannel).
-   **Styling:** Custom CSS with a mobile-first, responsive design.
-   **No Frameworks:** Built without React/Vue/Angular to demonstrate the raw power of browser APIs.

### Infrastructure
-   **Containerization:** Docker & Docker Compose (Alpine Linux base).
-   **TLS/HTTPS:** Caddy reverse proxy (HTTPS for WebRTC secure context).

---

## 🔄 How It Works (The Workflow)

### 1. The Handshake (Signaling)
Before two devices can talk directly, they need to know how to reach each other. This is done via the **Signaling Server**:
1.  **User A** joins a room.
2.  **User B** joins the same room.
3.  The server notifies User A that User B has joined.

### 2. Establishing the P2P Connection
When User A calls User B:
1.  **Offer:** User A creates an "Offer" (SDP) describing their media capabilities (codecs, encryption) and sends it to the server.
2.  **Relay:** The server forwards this Offer to User B.
3.  **Answer:** User B accepts the offer, creates an "Answer" (SDP), and sends it back via the server.
4.  **ICE Candidates:** Both devices discover their network paths (IP addresses, ports) and exchange them as "ICE Candidates".

### 3. Direct Communication (P2P)
Once the handshake is complete:
-   **Video/Audio:** Flows directly from Device A <-> Device B via UDP.
-   **Chat/Files:** Flows through an `RTCDataChannel` (SCTP protocol) directly between peers.
-   **Privacy:** The server **cannot** see or record the video, audio, or file contents.

---

## ⚡ P2P Verification
To prove the connection is truly Peer-to-Peer:
1.  Start a chat or call.
2.  Click the **⚡ (Lightning)** button in the chat header.
3.  This sends a timestamped message through the direct data channel.
4.  The round-trip time (Latency) will be displayed. In a local network, this is often **< 10ms**, which is impossible if routing through a remote server.

---

## 📦 Installation & Usage

### Prerequisites
-   Docker & Docker Compose (v2)
-   A modern web browser (Chrome, Firefox, Safari)

### Quick Start

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/yourusername/whisper.git
    cd whisper
    ```

2.  **Run with Docker Compose:**
    ```bash
    docker compose up -d --build
    ```

3.  **Access the App:**
    -   Open `https://YOUR_LOCAL_IP:8080` (e.g., `https://192.168.1.50:8080`) on your computer and mobile phone.
    -   If you use a public domain with Caddy, HTTPS is handled automatically.

### Why HTTPS?
WebRTC requires a "Secure Context" (HTTPS or localhost) to access the microphone and camera. In this project, HTTPS is provided by Caddy (reverse proxy) when deployed.

---

## 📱 Mobile Support
The application features a responsive design:
-   **Desktop:** Sidebar with user list is always visible.
-   **Mobile:** Sidebar slides away when chatting. Swipe or use the "Back" button to return to the user list.
-   **Controls:** Large, touch-friendly buttons for calls and media.

---

## 📝 License
MIT License - Feel free to use and modify for educational purposes.
