package main

import (
	"context"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"

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
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "error",
			"message": "Bad Request!",
		})
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
