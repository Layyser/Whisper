package main

import (
	"encoding/json"

	"github.com/gorilla/websocket"
)

type Client struct {
	ID       string          `json:"id"`
	Username string          `json:"username"`
	Conn     *websocket.Conn `json:"-"`
	Send     chan []byte     `json:"-"`
}

type Message struct {
	Type     string          `json:"type"`
	From     string          `json:"from,omitempty"`
	To       string          `json:"to,omitempty"`
	Username string          `json:"username,omitempty"`
	Data     json.RawMessage `json:"data,omitempty"`
	Users    []UserInfo      `json:"users,omitempty"`
}

type UserInfo struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}
