package main

import (
	"context"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"
	"time"

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

type Account struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Type     string  `json:"type"`
	Balance  float64 `json:"balance"`
	Currency string  `json:"currency"`
}

type Transaction struct {
	ID          string  `json:"id"`
	Date        string  `json:"date"`
	Description string  `json:"description"`
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency"`
	Category    string  `json:"category"`
}

var accounts = []Account{
	{ID: "acc-001", Name: "Main Checking", Type: "checking", Balance: 4825.50, Currency: "USD"},
	{ID: "acc-002", Name: "Savings", Type: "savings", Balance: 12340.00, Currency: "USD"},
	{ID: "acc-003", Name: "Credit Card", Type: "credit", Balance: -1250.75, Currency: "USD"},
}

var transactions = map[string][]Transaction{
	"acc-001": {
		{ID: "tx-101", Date: "2026-05-02", Description: "Grocery Store", Amount: -82.30, Currency: "USD", Category: "Groceries"},
		{ID: "tx-102", Date: "2026-05-01", Description: "Salary Deposit", Amount: 3500.00, Currency: "USD", Category: "Income"},
		{ID: "tx-103", Date: "2026-04-30", Description: "Electric Bill", Amount: -145.00, Currency: "USD", Category: "Utilities"},
		{ID: "tx-104", Date: "2026-04-28", Description: "Coffee Shop", Amount: -6.50, Currency: "USD", Category: "Dining"},
		{ID: "tx-105", Date: "2026-04-27", Description: "ATM Withdrawal", Amount: -200.00, Currency: "USD", Category: "Cash"},
	},
	"acc-002": {
		{ID: "tx-201", Date: "2026-05-01", Description: "Transfer from Checking", Amount: 500.00, Currency: "USD", Category: "Transfer"},
		{ID: "tx-202", Date: "2026-04-01", Description: "Transfer from Checking", Amount: 500.00, Currency: "USD", Category: "Transfer"},
		{ID: "tx-203", Date: "2026-03-15", Description: "Interest Payment", Amount: 18.50, Currency: "USD", Category: "Interest"},
	},
	"acc-003": {
		{ID: "tx-301", Date: "2026-05-02", Description: "Online Shopping", Amount: -299.99, Currency: "USD", Category: "Shopping"},
		{ID: "tx-302", Date: "2026-05-01", Description: "Restaurant", Amount: -67.80, Currency: "USD", Category: "Dining"},
		{ID: "tx-303", Date: "2026-04-29", Description: "Gas Station", Amount: -55.00, Currency: "USD", Category: "Transport"},
		{ID: "tx-304", Date: "2026-04-28", Description: "Payment - Thank You", Amount: 800.00, Currency: "USD", Category: "Payment"},
		{ID: "tx-305", Date: "2026-04-25", Description: "Subscription Service", Amount: -14.99, Currency: "USD", Category: "Subscriptions"},
		{ID: "tx-306", Date: "2026-04-22", Description: "Pharmacy", Amount: -32.50, Currency: "USD", Category: "Health"},
	},
}

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

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{
			"status": "ok",
		})
	})

	r.Get("/api/accounts", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(accounts)
	})

	r.Get("/api/accounts/{id}/transactions", func(w http.ResponseWriter, r *http.Request) {
		accountID := chi.URLParam(r, "id")

		txs, ok := transactions[accountID]
		if !ok {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			json.NewEncoder(w).Encode(map[string]string{
				"status":  "error",
				"message": "Account not found",
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(txs)
	})

	r.Post("/api/transfers", func(w http.ResponseWriter, r *http.Request) {
		// Simulate processing delay
		time.Sleep(500 * time.Millisecond)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "error",
			"message": "Transfer service unavailable: upstream payment gateway timeout",
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
