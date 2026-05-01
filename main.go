package main

import (
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/salaboy/reacting-to-ai/frontend"
)

type Alert struct {
	Status      string            `json:"status"`
	Labels      map[string]string `json:"labels"`
	Annotations map[string]string `json:"annotations"`
	StartsAt    string            `json:"startsAt"`
	EndsAt      string            `json:"endsAt"`
	Fingerprint string            `json:"fingerprint"`
}

type AlertmanagerWebhook struct {
	Version  string  `json:"version"`
	GroupKey string  `json:"groupKey"`
	Status   string  `json:"status"`
	Receiver string  `json:"receiver"`
	Alerts   []Alert `json:"alerts"`
}

var (
	alertsMu sync.RWMutex
	alerts   []Alert
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

	// Alertmanager webhook receiver
	r.Post("/api/webhook/alerts", func(w http.ResponseWriter, r *http.Request) {
		var payload AlertmanagerWebhook
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "invalid payload", http.StatusBadRequest)
			return
		}

		alertsMu.Lock()
		for i := range payload.Alerts {
			found := false
			for j := range alerts {
				if alerts[j].Fingerprint == payload.Alerts[i].Fingerprint {
					alerts[j] = payload.Alerts[i]
					found = true
					break
				}
			}
			if !found {
				alerts = append(alerts, payload.Alerts[i])
			}
		}
		if len(alerts) > 50 {
			alerts = alerts[len(alerts)-50:]
		}
		alertsMu.Unlock()

		log.Printf("Received %d alert(s) from Alertmanager (status: %s)", len(payload.Alerts), payload.Status)
		w.WriteHeader(http.StatusOK)
	})

	// Return current alerts for the frontend
	r.Get("/api/alerts", func(w http.ResponseWriter, r *http.Request) {
		alertsMu.RLock()
		current := make([]Alert, len(alerts))
		copy(current, alerts)
		alertsMu.RUnlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(current)
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
