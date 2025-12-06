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
	if username == "" {
		conn.Close()
		return
	}

	id := uuid.New().String() // Generate secure UUID

	client := &Client{
		ID:       id,
		Username: username,
		Conn:     conn,
		Send:     make(chan []byte, 256),
	}

	// Tell client their ID
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
		hub.message <- msg
	}
}
