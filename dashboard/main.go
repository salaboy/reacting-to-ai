package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/salaboy/reacting-to-ai/dashboard/frontend"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

const (
	defaultBusinessAgentURL = "http://business-agent.default.svc.cluster.local:8083"
	defaultFixerAgentURL    = "http://fixer-agent.default.svc.cluster.local:8081"
	defaultMonitorAgentURL  = "http://monitor-agent.default.svc.cluster.local:8082"
	defaultPrometheusURL    = "http://prometheus-kube-prometheus-prometheus.monitoring.svc.cluster.local:9090"
	defaultJaegerURL        = "http://jaeger-query.default.svc.cluster.local:16686"
	defaultGithubRepo       = "salaboy/reacting-to-ai"
)

type config struct {
	businessURL   string
	fixerURL      string
	monitorURL    string
	prometheusURL string
	jaegerURL     string
	githubToken   string
	githubRepo    string
}

func loadConfig() config {
	return config{
		businessURL:   envOr("BUSINESS_AGENT_URL", defaultBusinessAgentURL),
		fixerURL:      envOr("FIXER_AGENT_URL", defaultFixerAgentURL),
		monitorURL:    envOr("MONITOR_AGENT_URL", defaultMonitorAgentURL),
		prometheusURL: envOr("PROMETHEUS_URL", defaultPrometheusURL),
		jaegerURL:     envOr("JAEGER_URL", defaultJaegerURL),
		githubToken:   os.Getenv("GITHUB_TOKEN"),
		githubRepo:    envOr("GITHUB_REPO", defaultGithubRepo),
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var httpClient = &http.Client{Timeout: 5 * time.Second}

func initTracer() func() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	exporter, err := otlptracegrpc.New(ctx)
	if err != nil {
		log.Printf("Failed to create OTLP exporter: %v (tracing disabled)", err)
		return func() {}
	}

	res, err := resource.New(ctx,
		resource.WithAttributes(
			semconv.ServiceName("dashboard-app"),
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
		_ = tp.Shutdown(context.Background())
	}
}

// fetchJSON performs an HTTP GET and decodes the JSON body into out.
// Returns a descriptive error on non-2xx, network failure, or decode error.
func fetchJSON(ctx context.Context, urlStr string, headers map[string]string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("call %s: %w", urlStr, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("%s returned %d: %s", urlStr, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// sourceResult is the shape returned to the frontend for any single data source.
// When a source is unavailable, data is null and error contains the reason — the
// dashboard renders that panel as "unavailable" without breaking other panels.
type sourceResult struct {
	Source string `json:"source"`
	Data   any    `json:"data,omitempty"`
	Error  string `json:"error,omitempty"`
}

func okResult(source string, data any) sourceResult {
	return sourceResult{Source: source, Data: data}
}

func errResult(source string, err error) sourceResult {
	return sourceResult{Source: source, Error: err.Error()}
}

func newRouter(cfg config) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Route("/api", func(r chi.Router) {
		r.Get("/overview", handleOverview(cfg))

		r.Get("/business/evaluations", func(w http.ResponseWriter, r *http.Request) {
			var data any
			if err := fetchJSON(r.Context(), cfg.businessURL+"/api/evaluations/metadata", nil, &data); err != nil {
				writeJSON(w, http.StatusOK, errResult("business", err))
				return
			}
			writeJSON(w, http.StatusOK, okResult("business", data))
		})
		r.Get("/business/evaluations/{id}", func(w http.ResponseWriter, r *http.Request) {
			id := chi.URLParam(r, "id")
			var data any
			if err := fetchJSON(r.Context(), cfg.businessURL+"/api/evaluations/"+url.PathEscape(id), nil, &data); err != nil {
				writeJSON(w, http.StatusOK, errResult("business", err))
				return
			}
			writeJSON(w, http.StatusOK, okResult("business", data))
		})

		r.Get("/fixer/investigations", func(w http.ResponseWriter, r *http.Request) {
			var data any
			if err := fetchJSON(r.Context(), cfg.fixerURL+"/api/investigations", nil, &data); err != nil {
				writeJSON(w, http.StatusOK, errResult("fixer", err))
				return
			}
			writeJSON(w, http.StatusOK, okResult("fixer", data))
		})
		r.Get("/fixer/investigations/{id}", func(w http.ResponseWriter, r *http.Request) {
			id := chi.URLParam(r, "id")
			var data any
			if err := fetchJSON(r.Context(), cfg.fixerURL+"/api/investigations/"+url.PathEscape(id), nil, &data); err != nil {
				writeJSON(w, http.StatusOK, errResult("fixer", err))
				return
			}
			writeJSON(w, http.StatusOK, okResult("fixer", data))
		})

		r.Get("/monitor/alerts", func(w http.ResponseWriter, r *http.Request) {
			var data any
			if err := fetchJSON(r.Context(), cfg.monitorURL+"/api/alerts", nil, &data); err != nil {
				writeJSON(w, http.StatusOK, errResult("monitor", err))
				return
			}
			writeJSON(w, http.StatusOK, okResult("monitor", data))
		})
		r.Get("/monitor/investigations", func(w http.ResponseWriter, r *http.Request) {
			var data any
			if err := fetchJSON(r.Context(), cfg.monitorURL+"/api/investigations", nil, &data); err != nil {
				writeJSON(w, http.StatusOK, errResult("monitor", err))
				return
			}
			writeJSON(w, http.StatusOK, okResult("monitor", data))
		})

		r.Get("/stability", handleStability(cfg))
		r.Get("/github/prs", handleGithub(cfg, "pulls"))
		r.Get("/github/issues", handleGithub(cfg, "issues"))
		r.Get("/jaeger/errors", handleJaegerErrors(cfg))
	})

	// Embedded frontend.
	staticFS, err := fs.Sub(frontend.StaticFiles, "dist")
	if err != nil {
		log.Fatalf("frontend embed: %v", err)
	}
	r.Handle("/*", http.FileServer(http.FS(staticFS)))

	return otelhttp.NewHandler(r, "dashboard-app")
}

// handleOverview fans out to all four upstream agents in parallel and returns
// summary counts for the homepage cards.
func handleOverview(cfg config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var (
			wg          sync.WaitGroup
			evaluations []map[string]any
			fixerInvs   []map[string]any
			alerts      []map[string]any
			prs         []map[string]any
			issues      []map[string]any
			errs        = map[string]string{}
			mu          sync.Mutex
		)
		setErr := func(name string, err error) {
			mu.Lock()
			defer mu.Unlock()
			errs[name] = err.Error()
		}

		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := fetchJSON(r.Context(), cfg.businessURL+"/api/evaluations/metadata", nil, &evaluations); err != nil {
				setErr("business", err)
			}
		}()
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := fetchJSON(r.Context(), cfg.fixerURL+"/api/investigations", nil, &fixerInvs); err != nil {
				setErr("fixer", err)
			}
		}()
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := fetchJSON(r.Context(), cfg.monitorURL+"/api/alerts", nil, &alerts); err != nil {
				setErr("monitor", err)
			}
		}()
		if cfg.githubToken != "" {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if err := githubList(r.Context(), cfg, "pulls", "open", &prs); err != nil {
					setErr("github_prs", err)
				}
			}()
			wg.Add(1)
			go func() {
				defer wg.Done()
				if err := githubList(r.Context(), cfg, "issues", "open", &issues); err != nil {
					setErr("github_issues", err)
				}
			}()
		}
		wg.Wait()

		passed, failed, pending := 0, 0, 0
		for _, ev := range evaluations {
			switch v := ev["passed"].(type) {
			case bool:
				if v {
					passed++
				} else {
					failed++
				}
			default:
				pending++
			}
		}
		prCreated, errored, investigating := 0, 0, 0
		for _, inv := range fixerInvs {
			switch inv["status"] {
			case "pr_created":
				prCreated++
			case "error":
				errored++
			default:
				investigating++
			}
		}
		firing, resolved := 0, 0
		for _, a := range alerts {
			if a["status"] == "firing" {
				firing++
			} else {
				resolved++
			}
		}
		// GitHub /issues returns PRs too; strip them out for the issue count.
		issuesOnly := 0
		for _, i := range issues {
			if _, isPR := i["pull_request"]; !isPR {
				issuesOnly++
			}
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"evaluations": map[string]int{
				"total":   len(evaluations),
				"passed":  passed,
				"failed":  failed,
				"pending": pending,
			},
			"investigations": map[string]int{
				"total":         len(fixerInvs),
				"pr_created":    prCreated,
				"investigating": investigating,
				"error":         errored,
			},
			"alerts": map[string]int{
				"firing":   firing,
				"resolved": resolved,
			},
			"github": map[string]int{
				"prs_open":    len(prs),
				"issues_open": issuesOnly,
			},
			"errors": errs,
		})
	}
}

// handleStability runs three PromQL queries against spanmetrics in parallel
// and returns matrix-shaped data the frontend renders as sparklines.
func handleStability(cfg config) http.HandlerFunc {
	queries := map[string]string{
		"request_rate": `sum by (service_name) (rate(traces_span_metrics_calls_total[1m]))`,
		"error_rate":   `sum by (service_name) (rate(traces_span_metrics_calls_total{status_code="STATUS_CODE_ERROR"}[1m]))`,
		"latency_p95":  `histogram_quantile(0.95, sum by (le, service_name) (rate(traces_span_metrics_duration_milliseconds_bucket[5m])))`,
	}
	return func(w http.ResponseWriter, r *http.Request) {
		out := map[string]any{}
		errs := map[string]string{}
		var mu sync.Mutex
		var wg sync.WaitGroup
		for name, q := range queries {
			name, q := name, q
			wg.Add(1)
			go func() {
				defer wg.Done()
				end := time.Now()
				start := end.Add(-15 * time.Minute)
				u := fmt.Sprintf("%s/api/v1/query_range?query=%s&start=%d&end=%d&step=30",
					cfg.prometheusURL,
					url.QueryEscape(q),
					start.Unix(), end.Unix())
				var resp struct {
					Data map[string]any `json:"data"`
				}
				if err := fetchJSON(r.Context(), u, nil, &resp); err != nil {
					mu.Lock()
					errs[name] = err.Error()
					mu.Unlock()
					return
				}
				mu.Lock()
				out[name] = resp.Data
				mu.Unlock()
			}()
		}
		wg.Wait()
		writeJSON(w, http.StatusOK, map[string]any{
			"queries": out,
			"errors":  errs,
		})
	}
}

// githubList fetches a list of PRs or issues from the configured repo.
// kind must be "pulls" or "issues".
func githubList(ctx context.Context, cfg config, kind, state string, out *[]map[string]any) error {
	if cfg.githubToken == "" {
		return fmt.Errorf("GITHUB_TOKEN not configured")
	}
	u := fmt.Sprintf("https://api.github.com/repos/%s/%s?state=%s&per_page=30",
		cfg.githubRepo, kind, url.QueryEscape(state))
	headers := map[string]string{
		"Authorization":        "Bearer " + cfg.githubToken,
		"Accept":               "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	}
	return fetchJSON(ctx, u, headers, out)
}

func handleGithub(cfg config, kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		state := r.URL.Query().Get("state")
		if state == "" {
			state = "all"
		}
		var data []map[string]any
		if err := githubList(r.Context(), cfg, kind, state, &data); err != nil {
			writeJSON(w, http.StatusOK, errResult("github_"+kind, err))
			return
		}
		// /issues includes PRs; filter to actual issues when caller asked for issues.
		if kind == "issues" {
			filtered := make([]map[string]any, 0, len(data))
			for _, i := range data {
				if _, isPR := i["pull_request"]; !isPR {
					filtered = append(filtered, i)
				}
			}
			data = filtered
		}
		writeJSON(w, http.StatusOK, okResult("github_"+kind, data))
	}
}

// handleJaegerErrors pulls recent error traces for homebanking-app from Jaeger.
func handleJaegerErrors(cfg config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		service := r.URL.Query().Get("service")
		if service == "" {
			service = "homebanking-app"
		}
		end := time.Now().UnixMicro()
		start := time.Now().Add(-30 * time.Minute).UnixMicro()
		u := fmt.Sprintf(
			"%s/api/traces?service=%s&tags=%s&start=%d&end=%d&limit=20",
			cfg.jaegerURL,
			url.QueryEscape(service),
			url.QueryEscape(`{"error":"true"}`),
			start, end,
		)
		var data any
		if err := fetchJSON(r.Context(), u, nil, &data); err != nil {
			writeJSON(w, http.StatusOK, errResult("jaeger", err))
			return
		}
		writeJSON(w, http.StatusOK, okResult("jaeger", data))
	}
}

func main() {
	shutdown := initTracer()
	defer shutdown()

	cfg := loadConfig()
	handler := newRouter(cfg)

	port := envOr("PORT", "8085")
	log.Printf("Dashboard starting on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, handler))
}
