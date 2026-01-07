Informe de prácticas

Entrega 02

Alumno/a: Pau Bru Ribes  
Alumno/a: Jorge Vico Lora

Fecha: 7 de enero de 2026


Contenido
Introducción	1
Decisiones de diseño	1
Formato de código	1
Patrones de diseño	2
Gestión de errores	2
Arquitectura de la aplicación	3
Model	3
View	4
Controllers	4
Persistencia / Base de datos	5
Gestión de archivos	5
Seguridad y comunicaciones	6
Infraestructura y despliegue	7
Ficheros importantes	8
Bibliografía consultada	10


Introducción
Whisper es una app web para chat y llamadas P2P. Se entra en una sala y todo el trafico real (texto, voz, video, ficheros) va directo entre navegadores via WebRTC. El servidor solo hace señalizacion.

Stack:
- Backend: Go 1.23 + gorilla/websocket (solo señalizacion).
- Frontend: JS ES6, HTML5, CSS3 (sin frameworks).
- Infra: Docker Compose + Caddy como reverse proxy HTTPS.


Decisiones de diseño
Formato de código
Backend (Go)
- main sirve frontend y expone /ws. Hub y Room separan la logica de salas. Mensajes tipados en structs JSON.
- Concurrencia con goroutines y canales. Hub centraliza altas/bajas y envios.

Frontend (JS)
- Modulos ES6 por rol: websocket (senaliza), webrtc (P2P), ui (DOM), state (estado en memoria), main (puente con HTML).
- CSS mobile-first, un solo layout para moviles y escritorio.

Patrones de diseño
- Mediator: Hub coordina clientes en una sala.
- Pub/Sub: user-list y mensajes de sistema a todos en la sala.
- Event-driven: mensajes tipados offer/answer/ice/call.* por WS.
- Separacion de capas ligera: state (modelo), ui/index (vista), websocket/webrtc (controladores).

Gestión de errores
Backend
- Requiere username y room; si falta, cierra WS.
- Si la sala tiene password y no coincide, envia error y corta.
- Si un cliente no recibe, se descarta el envio para no bloquear el Hub.

Frontend
- Toasts para avisos (sin HTTPS, rechazo de llamada, canal P2P caido).
- Manejo de errores de getUserMedia con mensajes claros.
- UI muestra estado de conexion y si es P2P directo o relay.

Arquitectura de la aplicación
1) Usuario entra y elige sala. 2) WS a /ws para señalizar. 3) Servidor registra y envia user-list. 4) Al elegir usuario, se intercambian SDP y ICE por WS. 5) Conectados: DataChannel para chat/archivos y media tracks para voz/video (DTLS/SRTP). 6) Stats para ver tipo de ruta y bitrate.

Model
Sin base de datos; todo es en memoria.
- Backend: Room (id, password, clientes), Client (UUID, username, sala, WS, canal), Message (tipo, from/to, room_id, datos SDP/ICE, texto, users).
- Frontend: state.js guarda identidad, WS, peerConnections, historial local, contadores, estado de llamada y streams.

View
- index.html: login, lista de usuarios, chat, modal de llamada.
- style.css: tema oscuro responsive.
- ui.js: pinta usuarios, mensajes y toasts; carga historial en memoria.

Controllers
- websocket.js: arma URL WS (config o host actual), conecta y enruta mensajes (error, connected, user-list, system, resto a WebRTC).
- webrtc.js: PC + DataChannel, offer/answer, ICE, llamadas (request/accept/reject), ping P2P, envio de archivos y stats.
- main.js: expone handlers al HTML y gestiona envio de texto/archivos.

Persistencia / Base de datos
No hay BD. Sala y usuarios viven en RAM del servidor. Historial solo vive en el navegador. Al recargar se pierde.

Gestión de archivos
No se guardan en servidor. Se envian por DataChannel en chunks; el receptor arma un Blob y descarga.

Seguridad y comunicaciones
- WebRTC cifra por defecto (DTLS/SRTP).
- HTTPS es obligatorio para cam/mic; lo aporta Caddy.
- WS en /ws; salas pueden tener password.
- CheckOrigin permite cualquier origen (demo). En produccion se deberia restringir.
- STUN/TURN publicos; credenciales TURN deberian ir por configuracion/secretos en despliegue real.

Infraestructura y despliegue
- Docker Compose: backend (Go) + Caddy (80/443) como reverse proxy TLS.
- Caddyfile: reverse_proxy a backend:8080 y gestiona certs automaticos.
- Dockerfile multi-stage: build Go en arm64, runtime Alpine minimo con binario y frontend.

Ficheros importantes
Backend
- main.go: sirve frontend y WS en HTTP (TLS lo termina Caddy).
- hub.go: salas, altas/bajas, user-list, mensajes directos.
- websocket.go: upgrade, ciclo read/write, asigna UUID.
- types.go: modelos Client, Room, Message, UserInfo.
- go.mod: dependencias websocket y uuid.

Frontend
- frontend/index.html: estructura de pantallas y modales.
- frontend/js/websocket.js: cliente WS de señalizacion.
- frontend/js/webrtc.js: WebRTC completo (SDP/ICE, datachannel, llamadas, stats, archivos).
- frontend/js/ui.js: render de usuarios y chat.
- frontend/js/state.js: estado en memoria.
- frontend/js/config.js: STUN/TURN y endpoint WS publico.

Infraestructura
- docker-compose.yml: orquesta backend + Caddy.
- Caddyfile: proxy HTTPS.

Bibliografía consultada
WebRTC (MDN)  
https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API

RTCDataChannel (MDN)  
https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel

RTCPeerConnection (MDN)  
https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection

Gorilla WebSocket  
https://github.com/gorilla/websocket

Caddy Reverse Proxy  
https://caddyserver.com/docs/caddyfile/directives/reverse_proxy

Docker Compose  
https://docs.docker.com/compose/
