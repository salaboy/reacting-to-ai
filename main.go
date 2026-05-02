package main

import (
	"context"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"
	"sync"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/salaboy/reacting-to-ai/frontend"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
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

func initTracer() func() {
	ctx := context.Background()

	exporter, err := otlptracegrpc.New(ctx)
	if err != nil {
		log.Printf("Failed to create OTLP exporter: %v (tracing disabled)", err)
		return func() {}
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName("reacting-to-ai"),
		),
	)
	if err != nil {
		log.Printf("Failed to create resource: %v", err)
		res = resource.Default()
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)

	return func() {
		_ = tp.Shutdown(ctx)
	}
}

func main() {
	shutdown := initTracer()
	defer shutdown()

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

	// Wrap the router with OTel HTTP instrumentation
	handler := otelhttp.NewHandler(r, "reacting-to-ai")

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("Server starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, handler))
}
