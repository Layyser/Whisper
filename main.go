package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
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

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	// Comprovar si existeixen els certificats per a HTTPS
	// Check if certificates exist for HTTPS
	certFile := "certs/cert.pem"
	keyFile := "certs/key.pem"

	if _, err := os.Stat(certFile); err == nil {
		if _, err := os.Stat(keyFile); err == nil {
			fmt.Printf("Server on https://localhost:%s (Secure)\n", port)
			log.Fatal(http.ListenAndServeTLS(":"+port, certFile, keyFile, nil))
		}
	}

	fmt.Printf("Server on http://localhost:%s (Not Secure - Media devices might fail)\n", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
