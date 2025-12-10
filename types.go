package main

import (
	"encoding/json"
	"sync"

	"github.com/gorilla/websocket"
)

type Client struct {
	ID       string          `json:"id"`
	Username string          `json:"username"`
	RoomID   string          `json:"room_id"`
	Password string          `json:"-"` // Password provided by client
	Conn     *websocket.Conn `json:"-"`
	Send     chan []byte     `json:"-"`
}

type Message struct {
	Type     string          `json:"type"`
	From     string          `json:"from,omitempty"`
	To       string          `json:"to,omitempty"`
	Username string          `json:"username,omitempty"`
	RoomID   string          `json:"room_id,omitempty"`
	Data     json.RawMessage `json:"data,omitempty"`
	Content  string          `json:"content,omitempty"`
	Users    []UserInfo      `json:"users,omitempty"`
}

type UserInfo struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

type Room struct {
	ID       string             `json:"id"`
	Password string             `json:"-"`
	Clients  map[string]*Client `json:"-"`
	mu       sync.RWMutex
}
