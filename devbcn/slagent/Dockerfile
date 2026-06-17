# syntax=docker/dockerfile:1

# ── Build stage ──────────────────────────────────────────────────────────────
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Copy module files first (better layer caching)
COPY go.mod ./

# Download deps (none here, but good practice)
RUN go mod download

# Copy source and build a fully-static binary
COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server .

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM gcr.io/distroless/static:nonroot

WORKDIR /app
COPY --from=builder /app/server .

EXPOSE 8080

ENTRYPOINT ["/app/server"]
