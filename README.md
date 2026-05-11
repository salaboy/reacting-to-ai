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

### Dash0 for GitHub Actions CI traces (optional)

The `.github/workflows/otel-traces.yaml` workflow exports traces for each completed CI run to Dash0 using [corentinmusard/otel-cicd-action](https://github.com/corentinmusard/otel-cicd-action) (per [Dash0's GitHub Actions observability guide](https://www.dash0.com/guides/github-actions-observability-opentelemetry-tracing)). It re-uses the same variable names as the cluster setup, configured at the repository level:

| Repository setting | Type | Default | Maps to |
|---|---|---|---|
| `DASH0_AUTH_TOKEN` | Secret | *(none — disables export)* | `Authorization: Bearer …` header |
| `DASH0_ENDPOINT_OTLP_GRPC_HOSTNAME` | Variable | `ingress.eu-west-1.aws.dash0.com` | OTLP endpoint host |
| `DASH0_ENDPOINT_OTLP_GRPC_PORT` | Variable | `4317` | OTLP endpoint port |
| `DASH0_DATASET` | Variable | `salaboy` | `Dash0-Dataset` header |

Set them in **Settings → Secrets and variables → Actions** (secret for the token, repository variables for the others).

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
10. Installs Argo CD and Argo Rollouts
11. Installs Argo CD Image Updater (digest-pins `:main` so each new build triggers a blue/green rollout)
12. Deploys the monitor agent, fixer agent, and business agent
13. Configures the Argo CD Application (main app from `k8s/`) and the ApplicationSet for per-PR previews
14. Applies Ingress resources for path-based routing

## Accessing the UIs

All UIs are accessible via the NGINX Ingress Controller on `http://localhost`:

| Service | URL |
|---|---|
| Application (active) | http://localhost/ |
| Application (preview) | http://localhost/preview |
| Application (per-PR) | http://localhost/pr/&lt;number&gt;/ |
| Monitor Agent | http://localhost/monitor/ |
| Fixer Agent | http://localhost/fixer/ |
| Jaeger | http://localhost/jaeger/ui |
| Prometheus | http://localhost/prometheus/ |
| Alertmanager | http://localhost/alertmanager/ |
| Argo CD | http://localhost/argocd/ |

## Preview environments

Two parallel mechanisms let you exercise changes before they reach the active version:

### Post-merge blue/green preview (`/preview`)

The main app's Argo Rollout uses the blue/green strategy with `autoPromotionEnabled: false`. Argo CD Image Updater watches `ghcr.io/salaboy/homebanking-app:main` and rewrites `k8s/deployment.yaml` to pin the digest whenever a new image is built. That manifest change triggers the Rollout, which spins up a preview ReplicaSet behind `homebanking-app-preview` while keeping the active version in front of `/`.

While a rollout is paused:

```bash
# Watch progress
kubectl argo rollouts get rollout homebanking-app --watch

# Hit the candidate version directly
curl http://localhost/preview/api/health

# Promote to active (and scale down the old ReplicaSet)
kubectl argo rollouts promote homebanking-app

# Or roll back
kubectl argo rollouts abort homebanking-app
```

### Per-PR previews (`/pr/<n>/`)

When a PR is opened against `main`, CI builds and pushes `ghcr.io/salaboy/homebanking-app:pr-<n>`. An `ApplicationSet` with the `pullRequest` generator (`k8s-argocd/applicationset-prs.yaml`) creates one Argo CD Application per open PR, deploying the small chart at `helm/homebanking-app-pr/` into a dedicated `pr-<n>` namespace. The PR is reachable at `http://localhost/pr/<n>/`. When the PR is closed or merged, the Application is pruned along with its namespace.

Per-PR previews use a plain `Deployment` (no Rollout) since there is no prior version to roll over.

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
├── k8s/                             # Kubernetes manifests for the main app (deployed via Argo CD)
├── k8s-argocd/                      # Argo CD Application + ApplicationSet (PR previews)
├── k8s-ingress/                     # Ingress resources for path-based routing
├── k8s-observability/               # Helm values for Jaeger, OTel Collector, Prometheus
├── helm/homebanking-app-pr/         # Helm chart used by the per-PR ApplicationSet
├── agents/
│   ├── monitor-agent/               # Receives Alertmanager webhooks, queries Jaeger for related traces
│   └── fixer-agent/                 # AI agent that analyzes code and creates fix PRs
├── scripts/
│   └── setup-cluster.sh             # Full cluster setup script
└── .github/workflows/               # CI/CD pipelines for container images
```
