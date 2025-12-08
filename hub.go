package main

import (
	"encoding/json"
	"log"
	"sync"
)

type Hub struct {
	rooms      map[string]*Room // Mapa de RoomID a Room
	register   chan *Client
	unregister chan *Client
	message    chan Message
	mu         sync.RWMutex
}

func newHub() *Hub {
	return &Hub{
		rooms:      make(map[string]*Room),
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
			room, exists := h.rooms[client.RoomID]
			if !exists {
				room = &Room{
					ID:      client.RoomID,
					Clients: make(map[string]*Client),
				}
				h.rooms[client.RoomID] = room
			}
			h.mu.Unlock()

			room.join(client)
			log.Printf("User joined room %s: %s (%s)", client.RoomID, client.Username, client.ID)
			
			h.broadcastUserList(room)
			h.broadcastSystemMessage(room, client.Username+" joined the room")

		case client := <-h.unregister:
			h.mu.Lock()
			room, ok := h.rooms[client.RoomID]
			h.mu.Unlock()

			if ok {
				room.leave(client)
				close(client.Send)
				log.Printf("User left room %s: %s (%s)", client.RoomID, client.Username, client.ID)

				// Comprovar si la sala està buida
				room.mu.RLock()
				empty := len(room.Clients) == 0
				room.mu.RUnlock()

				if empty {
					h.mu.Lock()
					delete(h.rooms, client.RoomID)
					h.mu.Unlock()
				} else {
					h.broadcastUserList(room)
					h.broadcastSystemMessage(room, client.Username+" left the room")
				}
			}

		case msg := <-h.message:
			h.mu.RLock()
			room, ok := h.rooms[msg.RoomID]
			h.mu.RUnlock()

			if ok {
				if msg.To != "" {
					// Missatge directe
					room.mu.RLock()
					target, ok := room.Clients[msg.To]
					room.mu.RUnlock()
					
					if ok {
						data, _ := json.Marshal(msg)
						select {
						case target.Send <- data:
						default:
							log.Printf("Failed to send to %s", msg.To)
						}
					}
				}
			}
		}
	}
}

func (r *Room) join(client *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Clients[client.ID] = client
}

func (r *Room) leave(client *Client) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.Clients, client.ID)
}

func (h *Hub) broadcastUserList(room *Room) {
	room.mu.RLock()
	users := make([]UserInfo, 0, len(room.Clients))
	for _, client := range room.Clients {
		users = append(users, UserInfo{
			ID:       client.ID,
			Username: client.Username,
		})
	}
	room.mu.RUnlock()

	msg := Message{
		Type:  "user-list",
		Users: users,
	}
	data, _ := json.Marshal(msg)

	room.mu.RLock()
	defer room.mu.RUnlock()
	for _, client := range room.Clients {
		select {
		case client.Send <- data:
		default:
		}
	}
}

func (h *Hub) broadcastSystemMessage(room *Room, content string) {
	msg := Message{
		Type:    "system",
		Content: content,
	}
	data, _ := json.Marshal(msg)

	room.mu.RLock()
	defer room.mu.RUnlock()
	for _, client := range room.Clients {
		select {
		case client.Send <- data:
		default:
		}
	}
}
