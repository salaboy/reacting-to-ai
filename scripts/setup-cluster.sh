#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OBSERVABILITY_DIR="$PROJECT_ROOT/k8s-observability"

CLUSTER_NAME="${KIND_CLUSTER_NAME:-reacting-to-ai}"

# -------------------------------------------------------
# Pre-flight: check required environment variables
# -------------------------------------------------------
MISSING=""
if [ -z "${GITHUB_TOKEN:-}" ]; then
  MISSING="$MISSING  GITHUB_TOKEN\n"
fi
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  MISSING="$MISSING  ANTHROPIC_API_KEY\n"
fi
if [ -n "$MISSING" ]; then
  echo "ERROR: The following required environment variables are not set:"
  echo -e "$MISSING"
  echo "These are needed to create the fixer-agent secrets."
  echo "Set them and re-run:"
  echo "  export GITHUB_TOKEN=ghp_..."
  echo "  export ANTHROPIC_API_KEY=sk-ant-..."
  exit 1
fi

echo "=== HomeBanking App - Cluster & Observability Setup ==="
echo ""

# -------------------------------------------------------
# 1. Create KinD cluster
# -------------------------------------------------------
echo "--- Creating KinD cluster: $CLUSTER_NAME ---"
if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
  echo "Cluster '$CLUSTER_NAME' already exists, skipping creation."
else
  kind create cluster --name "$CLUSTER_NAME" --config "$PROJECT_ROOT/kind-config.yaml" --wait 5m
fi
kubectl cluster-info --context "kind-${CLUSTER_NAME}"
echo ""

# -------------------------------------------------------
# 1b. Install NGINX Ingress Controller
# -------------------------------------------------------
echo "--- Installing NGINX Ingress Controller ---"
if kubectl get deploy ingress-nginx-controller -n ingress-nginx &>/dev/null; then
  echo "NGINX Ingress Controller is already installed, skipping."
else
  kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/deploy/static/provider/kind/deploy.yaml
  echo "Waiting for ingress controller to be ready..."
  kubectl wait --namespace ingress-nginx \
    --for=condition=ready pod \
    --selector=app.kubernetes.io/component=controller \
    --timeout=120s
fi
echo ""

# -------------------------------------------------------
# 2. Add all Helm repos and update once
# -------------------------------------------------------
echo "--- Adding Helm repos ---"
helm repo add jaegertracing https://jaegertracing.github.io/helm-charts 2>/dev/null || true
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts 2>/dev/null || true
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts 2>/dev/null || true
helm repo add jetstack https://charts.jetstack.io --force-update
helm repo add argo https://argoproj.github.io/argo-helm 2>/dev/null || true
helm repo add bitnami https://charts.bitnami.com/bitnami 2>/dev/null || true
helm repo update
echo ""

# -------------------------------------------------------
# 2b. Install Jaeger
# -------------------------------------------------------
echo "--- Installing Jaeger ---"
helm upgrade --install jaeger jaegertracing/jaeger \
  --version 3.4.1 \
  -f "$OBSERVABILITY_DIR/jaeger-values.yaml" \
  --wait
echo "Jaeger pods:"
kubectl get pods -l app.kubernetes.io/name=jaeger
echo ""

# -------------------------------------------------------
# 3. Create OpenTelemetry namespace and configure Dash0
# -------------------------------------------------------
echo "--- Creating OpenTelemetry namespace ---"
kubectl create namespace opentelemetry --dry-run=client -o yaml | kubectl apply -f -

if [ -n "${DASH0_AUTH_TOKEN:-}" ]; then
  DASH0_ENDPOINT_OTLP_GRPC_HOSTNAME="${DASH0_ENDPOINT_OTLP_GRPC_HOSTNAME:-ingress.eu-west-1.aws.dash0.com}"
  DASH0_ENDPOINT_OTLP_GRPC_PORT="${DASH0_ENDPOINT_OTLP_GRPC_PORT:-4317}"
  DASH0_DATASET="${DASH0_DATASET:-salaboy}"

  kubectl create secret generic dash0-secrets \
    --from-literal=dash0-authorization-token="$DASH0_AUTH_TOKEN" \
    --from-literal=dash0-grpc-hostname="$DASH0_ENDPOINT_OTLP_GRPC_HOSTNAME" \
    --from-literal=dash0-grpc-port="$DASH0_ENDPOINT_OTLP_GRPC_PORT" \
    --from-literal=dash0-dataset="$DASH0_DATASET" \
    --namespace=opentelemetry \
    --dry-run=client -o yaml | kubectl apply -f -
  echo "Dash0 secrets created. Collector will export to both Jaeger and Dash0."
  COLLECTOR_VALUES="$OBSERVABILITY_DIR/collector-config.yaml"
else
  echo "DASH0_AUTH_TOKEN not set. Collector will export to Jaeger only."
  COLLECTOR_VALUES="$OBSERVABILITY_DIR/collector-config-jaeger-only.yaml"
fi
echo ""

# -------------------------------------------------------
# 4. Install Prometheus & Alertmanager
# -------------------------------------------------------
echo "--- Installing Prometheus & Alertmanager ---"
helm upgrade --install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace \
  -f "$OBSERVABILITY_DIR/prometheus-values.yaml" \
  --wait
echo "Prometheus & Alertmanager pods:"
kubectl get pods -n monitoring
echo ""

# -------------------------------------------------------
# 5. Install OpenTelemetry Collector (with spanmetrics)
# -------------------------------------------------------
echo "--- Installing OpenTelemetry Collector ---"
helm upgrade --install otel-collector open-telemetry/opentelemetry-collector \
  --namespace opentelemetry \
  -f "$COLLECTOR_VALUES" \
  --wait
echo "OpenTelemetry Collector pods:"
kubectl get pods -n opentelemetry -l app.kubernetes.io/name=opentelemetry-collector
echo ""

# -------------------------------------------------------
# 6. Install cert-manager
# -------------------------------------------------------
echo "--- Installing cert-manager ---"
helm upgrade --install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set crds.enabled=true \
  --wait
echo "cert-manager pods:"
kubectl get pods -n cert-manager
echo ""

# -------------------------------------------------------
# 7. Install OpenTelemetry Operator
# -------------------------------------------------------
echo "--- Installing OpenTelemetry Operator ---"
helm upgrade --install opentelemetry-operator open-telemetry/opentelemetry-operator \
  --namespace opentelemetry \
  --set manager.extraArgs='{--enable-go-instrumentation}' \
  --wait
echo "OpenTelemetry Operator pods:"
kubectl get pods -n opentelemetry -l app.kubernetes.io/name=opentelemetry-operator
echo ""

# -------------------------------------------------------
# 8. Apply OpenTelemetry Instrumentation resource
# -------------------------------------------------------
echo "--- Applying OpenTelemetry Instrumentation ---"
kubectl apply -f "$OBSERVABILITY_DIR/instrumentation.yaml"
echo "Instrumentation resource applied."
echo ""

# -------------------------------------------------------
# 9. Install Argo CD
# -------------------------------------------------------
echo "--- Installing Argo CD ---"
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f -
helm upgrade --install argocd argo/argo-cd \
  --namespace argocd \
  -f "$OBSERVABILITY_DIR/argocd-values.yaml" \
  --wait
echo "Argo CD pods:"
kubectl get pods -n argocd
echo ""

# -------------------------------------------------------
# 10. Install Argo Rollouts
# -------------------------------------------------------
echo "--- Installing Argo Rollouts ---"
kubectl create namespace argo-rollouts --dry-run=client -o yaml | kubectl apply -f -
helm upgrade --install argo-rollouts argo/argo-rollouts \
  --namespace argo-rollouts \
  -f "$OBSERVABILITY_DIR/argo-rollouts-values.yaml" \
  --wait
echo "Argo Rollouts pods:"
kubectl get pods -n argo-rollouts
echo ""

# -------------------------------------------------------
# 10b. Install Argo CD Image Updater
# -------------------------------------------------------
echo "--- Installing Argo CD Image Updater ---"

GITHUB_USER="${GITHUB_ACTOR:-salaboy}"

# Registry credential so Image Updater can read GHCR tag list / digests
kubectl create secret docker-registry ghcr-creds \
  --docker-server=ghcr.io \
  --docker-username="$GITHUB_USER" \
  --docker-password="$GITHUB_TOKEN" \
  --namespace=argocd \
  --dry-run=client -o yaml | kubectl apply -f -

# Repo credential so Image Updater (and Argo CD) can write manifest updates back to git
kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: reacting-to-ai-repo
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: repository
stringData:
  url: https://github.com/salaboy/reacting-to-ai.git
  username: $GITHUB_USER
  password: $GITHUB_TOKEN
EOF

helm upgrade --install argocd-image-updater argo/argocd-image-updater \
  --namespace argocd \
  --set config.gitCommitUser=argocd-image-updater \
  --set config.gitCommitMail=argocd-image-updater@noreply.local \
  --wait
echo "Argo CD Image Updater pods:"
kubectl get pods -n argocd -l app.kubernetes.io/name=argocd-image-updater
echo ""

# -------------------------------------------------------
# 11. Deploy agents
# -------------------------------------------------------
# -------------------------------------------------------
# 10c. Install PostgreSQL with pgvector for knowledge-agent
# -------------------------------------------------------
echo "--- Installing PostgreSQL (pgvector) for knowledge-agent ---"
helm upgrade --install postgresql bitnami/postgresql \
  --namespace default \
  -f "$PROJECT_ROOT/agents/knowledge-agent/k8s/postgresql-values.yaml" \
  --wait
echo "PostgreSQL pods:"
kubectl get pods -l app.kubernetes.io/name=postgresql
echo ""

echo "--- Deploying Monitor Agent ---"
kubectl apply -f "$PROJECT_ROOT/agents/monitor-agent/k8s/"
echo "Monitor Agent deployed."
echo ""

echo "--- Deploying Fixer Agent ---"
kubectl create secret generic fixer-agent-secrets \
  --from-literal=anthropic-api-key="$ANTHROPIC_API_KEY" \
  --from-literal=github-token="$GITHUB_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f "$PROJECT_ROOT/agents/fixer-agent/k8s/"
echo "Fixer Agent deployed."
echo ""

echo "--- Deploying Business Agent ---"
kubectl create secret generic business-agent-secrets \
  --from-literal=anthropic-api-key="$ANTHROPIC_API_KEY" \
  --from-literal=github-token="$GITHUB_TOKEN" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f "$PROJECT_ROOT/agents/business-agent/k8s/"
echo "Business Agent deployed."
echo ""

echo "--- Deploying Knowledge Agent ---"
kubectl apply -f "$PROJECT_ROOT/agents/knowledge-agent/k8s/deployment.yaml"
kubectl apply -f "$PROJECT_ROOT/agents/knowledge-agent/k8s/service.yaml"
echo "Knowledge Agent deployed."
echo ""

echo "--- Deploying Dashboard ---"
kubectl apply -f "$PROJECT_ROOT/dashboard/k8s/"
echo "Dashboard deployed."
echo ""

# -------------------------------------------------------
# 12. Deploy application via Argo CD
# -------------------------------------------------------
echo "--- Configuring Argo CD Application ---"
kubectl apply -f "$PROJECT_ROOT/k8s-argocd/application.yaml"
echo "Argo CD Application 'homebanking-app' created. It will sync from k8s/ in the main branch."
echo ""

# -------------------------------------------------------
# 12b. Configure ApplicationSet for per-PR previews
# -------------------------------------------------------
echo "--- Configuring per-PR preview ApplicationSet ---"
kubectl create secret generic github-token \
  --from-literal=token="$GITHUB_TOKEN" \
  --namespace=argocd \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f "$PROJECT_ROOT/k8s-argocd/applicationset-prs.yaml"
echo "ApplicationSet 'homebanking-app-pr-previews' created. Open PRs will be reachable at http://localhost/pr/<n>/."
echo ""

# -------------------------------------------------------
# 13. Apply Ingress resources
# -------------------------------------------------------
echo "--- Applying Ingress resources ---"
kubectl apply -f "$PROJECT_ROOT/k8s-ingress/ingress.yaml"
echo "Ingress resources applied."
echo ""

echo "=== Cluster & Observability setup complete ==="
echo ""
echo "Cluster: $CLUSTER_NAME"
echo ""
echo "All UIs are accessible via the ingress controller on http://localhost:"
echo ""
echo "  Application (active):   http://localhost/"
echo "  Application (preview):  http://localhost/preview      (next blue/green candidate)"
echo "  Application (PR <n>):   http://localhost/pr/<n>/      (per-PR preview, while PR is open)"
echo "  Monitor Agent:          http://localhost/monitor/"
echo "  Fixer Agent:            http://localhost/fixer/"
echo "  Business Agent:         http://localhost/business/"
echo "  Knowledge Agent:        http://localhost/knowledge/"
echo "  Dashboard:              http://localhost/dashboard/"
echo "  Jaeger:                 http://localhost/jaeger/ui"
echo "  Prometheus:             http://localhost/prometheus/"
echo "  Alertmanager:           http://localhost/alertmanager/"
echo "  Argo CD:                http://localhost/argocd/"
echo ""
echo "Argo CD credentials:"
echo "  Username: admin"
echo "  Password: kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d"
