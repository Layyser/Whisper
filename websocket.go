package main

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func handleWebSocket(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	username := r.URL.Query().Get("username")
	roomID := r.URL.Query().Get("room")
	password := r.URL.Query().Get("password")
	if username == "" || roomID == "" {
		conn.Close()
		return
	}

	id := uuid.New().String() // Generar UUID segur

	client := &Client{
		ID:       id,
		Username: username,
		RoomID:   roomID,
		Password: password,
		Conn:     conn,
		Send:     make(chan []byte, 256),
	}

	// Informar al client del seu ID
	conn.WriteJSON(Message{
		Type: "connected",
		From: id,
	})

	hub.register <- client
	go writePump(client)
	go readPump(client, hub)
}

func writePump(client *Client) {
	defer client.Conn.Close()
	for msg := range client.Send {
		if err := client.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			break
		}
	}
}

func readPump(client *Client, hub *Hub) {
	defer func() {
		hub.unregister <- client
		client.Conn.Close()
	}()

	for {
		var msg Message
		if err := client.Conn.ReadJSON(&msg); err != nil {
			break
		}
		msg.From = client.ID
		msg.RoomID = client.RoomID
		hub.message <- msg
	}
}
