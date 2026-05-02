# Fixer Agent

An AI-powered agent that receives alerts, investigates application source code, and creates pull requests with fixes.

## Running with Docker

### Build the image

```sh
docker build -t fixer-agent .
```

### Start the container

```sh
docker run -p 8081:8081 \
  -e ANTHROPIC_API_KEY=<your-anthropic-api-key> \
  -e GITHUB_TOKEN=<your-github-token> \
  fixer-agent
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key used by the LangChain ChatAnthropic client |
| `GITHUB_TOKEN` | Yes | GitHub personal access token for cloning the repo and creating pull requests |
| `REPO_URL` | No | Repository to investigate (defaults to `https://github.com/salaboy/reacting-to-ai.git`) |

## Testing the container

### Health check

```sh
curl http://localhost:8081/health
```

Expected response:

```json
{"status": "ok"}
```

### Submit an alert

```sh
curl -X POST http://localhost:8081/fix \
  -H "Content-Type: application/json" \
  -d '{
    "alert_name": "HighErrorRate",
    "description": "Service returning 500 errors on /api/data endpoint",
    "labels": {"severity": "critical", "service": "api"},
    "annotations": {"summary": "Error rate above 5% for 10 minutes"}
  }'
```

Expected response:

```json
{"status": "accepted", "investigation_id": "<id>"}
```

### Submit an alert with trace information

```sh
curl -X POST http://localhost:8081/fix \
  -H "Content-Type: application/json" \
  -d '{
    "alert_name": "SlowResponses",
    "description": "P99 latency above 2s on checkout service",
    "labels": {"severity": "warning", "service": "checkout"},
    "annotations": {"summary": "Latency spike detected"},
    "related_traces": [
      {
        "traceID": "abc123",
        "operationName": "POST /checkout",
        "serviceName": "checkout",
        "duration": 3200000,
        "startTime": 1714600000000000,
        "spanCount": 12,
        "jaegerUrl": "http://jaeger:16686/trace/abc123"
      }
    ]
  }'
```

### Check investigation status

```sh
curl http://localhost:8081/api/investigations
```

This returns a list of all investigations with their current status. Possible statuses: `pending`, `cloning`, `investigating`, `creating_pr`, `pr_created`, `no_fix_needed`, `error`.
