package main

import (
	"encoding/json"
	"log"
	"sync"
)

type Hub struct {
	clients    map[string]*Client
	register   chan *Client
	unregister chan *Client
	message    chan Message
	mu         sync.RWMutex
}

func newHub() *Hub {
	return &Hub{
		clients:    make(map[string]*Client),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		message:    make(chan Message),
	}
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client.ID] = client
			h.mu.Unlock()
			log.Printf("User joined: %s (%s)", client.Username, client.ID)
			h.broadcastUserList()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.ID]; ok {
				delete(h.clients, client.ID)
				close(client.Send)
				log.Printf("User left: %s (%s)", client.Username, client.ID)
			}
			h.mu.Unlock()
			h.broadcastUserList()

		case msg := <-h.message:
			h.mu.RLock()
			if msg.To != "" {
				// Direct message to specific user
				if target, ok := h.clients[msg.To]; ok {
					data, _ := json.Marshal(msg)
					select {
					case target.Send <- data:
					default:
						log.Printf("Failed to send to %s", msg.To)
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *Hub) broadcastUserList() {
	h.mu.RLock()
	users := make([]UserInfo, 0, len(h.clients))
	for _, client := range h.clients {
		users = append(users, UserInfo{
			ID:       client.ID,
			Username: client.Username,
		})
	}
	h.mu.RUnlock()

	msg := Message{
		Type:  "user-list",
		Users: users,
	}
	data, _ := json.Marshal(msg)

	h.mu.RLock()
	for _, client := range h.clients {
		select {
		case client.Send <- data:
		default:
		}
	}
	h.mu.RUnlock()
}
