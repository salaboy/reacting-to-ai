# Reacting To AI

We are heading to fully automate the software development lifecycle. The question is how can we do that if we were always really bad at deliverying software at scale. Only large and mature organizations who have invested millions in software practices managed to achieve an efficient delivery pipeline. 

If code is going away (cheap to produce, easy to throw away and regenerate), does it matter anymore? Can we skip all the phases that we introduced to make the software delivery pipeline secure and robust? Can we let agents push things to production? 

Things are changing, so let's explore how this transition might look like, keeping in mind that historically, we know how good software is developed and deployed but we are quite bad at implementing those practices at scale. 

Join me in a cloud native exploration of this new era. 

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

1. Creates a KinD cluster (with ingress port mappings)
2. Installs the NGINX Ingress Controller
3. Installs Jaeger (in-memory, all-in-one)
4. Creates the OpenTelemetry namespace and configures Dash0 secrets (if token is set)
5. Installs Prometheus and Alertmanager (with the `HighErrorRate` alert rule)
6. Installs the OpenTelemetry Collector (with spanmetrics connector)
7. Installs cert-manager
8. Installs the OpenTelemetry Operator
9. Applies the OpenTelemetry Instrumentation resource
10. Installs Argo CD
11. Deploys the monitor agent and fixer agent
12. Configures the Argo CD Application to sync the main app from `k8s/`
13. Applies Ingress resources for path-based routing

## Accessing the UIs

All UIs are accessible via the NGINX Ingress Controller on `http://localhost`:

| Service | URL |
|---|---|
| Application | http://localhost/ |
| Monitor Agent | http://localhost/monitor/ |
| Fixer Agent | http://localhost/fixer/ |
| Jaeger | http://localhost/jaeger/ui |
| Prometheus | http://localhost/prometheus/ |
| Alertmanager | http://localhost/alertmanager/ |
| Argo CD | http://localhost/argocd/ |

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
├── k8s-ingress/                     # Ingress resources for path-based routing
├── k8s-observability/               # Helm values for Jaeger, OTel Collector, Prometheus
├── agents/
│   ├── monitor-agent/               # Receives Alertmanager webhooks, queries Jaeger for related traces
│   └── fixer-agent/                 # AI agent that analyzes code and creates fix PRs
├── scripts/
│   └── setup-cluster.sh             # Full cluster setup script
└── .github/workflows/               # CI/CD pipelines for container images
```
