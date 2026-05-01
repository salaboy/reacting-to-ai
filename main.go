package main

import (
	"encoding/json"
	"io/fs"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/salaboy/reacting-to-ai/frontend"
)

func main() {
	r := chi.NewRouter()
	r.Use(middleware.Logger)

	r.Get("/api/success", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "ok",
			"message": "Success! Everything is working.",
		})
	})

	r.Get("/api/error", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "error",
			"message": "Internal Server Error!",
		})
	})

	// Serve the React frontend
	staticFS, err := fs.Sub(frontend.StaticFiles, "dist")
	if err != nil {
		log.Fatal(err)
	}
	fileServer := http.FileServer(http.FS(staticFS))
	r.Handle("/*", fileServer)

	log.Println("Server starting on :8080")
	log.Fatal(http.ListenAndServe(":8080", r))
}
