# reacting-to-ai

A Go application with a React frontend, an observability stack, and AI-powered agents for monitoring and fixing issues — all deployed to Kubernetes via GitOps.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [KinD](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- [Helm](https://helm.sh/docs/intro/install/)

## Environment Variables

### Dash0 (optional)

Set these to export telemetry to Dash0 in addition to Jaeger. If `DASH0_AUTH_TOKEN` is not set, the collector exports to Jaeger only.

| Variable | Default | Description |
|---|---|---|
| `DASH0_AUTH_TOKEN` | *(none)* | Bearer token for Dash0 authentication |
| `DASH0_ENDPOINT_OTLP_GRPC_HOSTNAME` | `ingress.eu-west-1.aws.dash0.com` | Dash0 gRPC endpoint hostname |
| `DASH0_ENDPOINT_OTLP_GRPC_PORT` | `4317` | Dash0 gRPC endpoint port |
| `DASH0_DATASET` | `salaboy` | Dash0 dataset name |

### Cluster name (optional)

| Variable | Default | Description |
|---|---|---|
| `KIND_CLUSTER_NAME` | `reacting-to-ai` | Name for the KinD cluster |

## Kubernetes Secrets

### Fixer Agent

The fixer agent requires an Anthropic API key and a GitHub token to analyze code and create pull requests. Create the secret **before** running the setup script:

```bash
kubectl create secret generic fixer-agent-secrets \
  --from-literal=anthropic-api-key=$ANTHROPIC_API_KEY \
  --from-literal=github-token=$GITHUB_TOKEN
```

- `ANTHROPIC_API_KEY` — Claude API key used by the LangChain agent
- `GITHUB_TOKEN` — GitHub personal access token with `repo` scope (to push branches and create PRs)

If this secret is not present when the setup script runs, the fixer agent deployment will be skipped with instructions to create it.

## Cluster Setup

Run the setup script to create a KinD cluster with the full stack:

```bash
# Jaeger only
./scripts/setup-cluster.sh

# With Dash0 export
DASH0_AUTH_TOKEN=your-token ./scripts/setup-cluster.sh
```

The script performs these steps:

1. Creates a KinD cluster
2. Installs Jaeger (in-memory, all-in-one)
3. Creates the OpenTelemetry namespace and configures Dash0 secrets (if token is set)
4. Installs Prometheus and Alertmanager (with the `HighErrorRate` alert rule)
5. Installs the OpenTelemetry Collector (with spanmetrics connector)
6. Installs cert-manager
7. Installs the OpenTelemetry Operator
8. Applies the OpenTelemetry Instrumentation resource
9. Installs Argo CD
10. Deploys the monitor agent and fixer agent
11. Configures the Argo CD Application to sync the main app from `k8s/`

## Accessing the UIs

After the setup completes, use `kubectl port-forward` to access each service:

| Service | Command | URL |
|---|---|---|
| Application | `kubectl port-forward svc/reacting-to-ai 8080:80` | http://localhost:8080 |
| Monitor Agent | `kubectl port-forward svc/monitor-agent 8082` | http://localhost:8082 |
| Jaeger | `kubectl port-forward svc/jaeger-query 16686` | http://localhost:16686 |
| Prometheus | `kubectl port-forward svc/prometheus-kube-prometheus-prometheus -n monitoring 9090` | http://localhost:9090 |
| Alertmanager | `kubectl port-forward svc/prometheus-kube-prometheus-alertmanager -n monitoring 9093` | http://localhost:9093 |
| Argo CD | `kubectl port-forward svc/argocd-server -n argocd 8443:443` | https://localhost:8443 |

Argo CD credentials:

```bash
# Username: admin
# Password:
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
```

## Project Structure

```
.
├── main.go                          # Go application (Chi router + OTel instrumentation)
├── frontend/                        # React frontend for the main app
├── k8s/                             # Kubernetes manifests (deployed via Argo CD)
├── k8s-argocd/                      # Argo CD Application resource
├── k8s-observability/               # Helm values for Jaeger, OTel Collector, Prometheus
├── agents/
│   ├── monitor-agent/               # Receives Alertmanager webhooks, queries Jaeger for related traces
│   └── fixer-agent/                 # AI agent that analyzes code and creates fix PRs
├── scripts/
│   └── setup-cluster.sh             # Full cluster setup script
└── .github/workflows/               # CI/CD pipelines for container images
```
