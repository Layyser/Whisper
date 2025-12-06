package main

import (
	"fmt"
	"log"
	"net/http"
	"path/filepath"
)

func main() {
	hub := newHub()
	go hub.run()

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			http.Error(w, "Method not allowed", 405)
			return
		}
		path := r.URL.Path
		if path == "/" {
			path = "/index.html"
		}
		http.ServeFile(w, r, filepath.Join("frontend", path))
	})

	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		handleWebSocket(hub, w, r)
	})

	fmt.Println("Server on http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
