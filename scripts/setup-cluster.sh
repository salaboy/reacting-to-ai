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

echo "=== Reacting to AI - Cluster & Observability Setup ==="
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
# 2. Install Jaeger
# -------------------------------------------------------
echo "--- Installing Jaeger ---"
helm repo add jaegertracing https://jaegertracing.github.io/helm-charts 2>/dev/null || true
helm repo update
if helm status jaeger &>/dev/null; then
  echo "Jaeger is already installed, skipping."
else
  helm install jaeger jaegertracing/jaeger --version 3.4.1 -f "$OBSERVABILITY_DIR/jaeger-values.yaml" --wait
fi
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
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts 2>/dev/null || true
helm repo update
if helm status prometheus -n monitoring &>/dev/null; then
  echo "Prometheus is already installed, upgrading with current config."
  helm upgrade prometheus prometheus-community/kube-prometheus-stack \
    --namespace monitoring \
    -f "$OBSERVABILITY_DIR/prometheus-values.yaml" \
    --wait
else
  helm install prometheus prometheus-community/kube-prometheus-stack \
    --namespace monitoring --create-namespace \
    -f "$OBSERVABILITY_DIR/prometheus-values.yaml" \
    --wait
fi
echo "Prometheus & Alertmanager pods:"
kubectl get pods -n monitoring
echo ""

# -------------------------------------------------------
# 5. Install OpenTelemetry Collector (with spanmetrics)
# -------------------------------------------------------
echo "--- Installing OpenTelemetry Collector ---"
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts 2>/dev/null || true
helm repo update
if helm status otel-collector -n opentelemetry &>/dev/null; then
  echo "OpenTelemetry Collector is already installed, upgrading with current config."
  helm upgrade otel-collector open-telemetry/opentelemetry-collector \
    --namespace opentelemetry \
    -f "$COLLECTOR_VALUES" \
    --wait
else
  helm install otel-collector open-telemetry/opentelemetry-collector \
    --namespace opentelemetry \
    -f "$COLLECTOR_VALUES" \
    --wait
fi
echo "OpenTelemetry Collector pods:"
kubectl get pods -n opentelemetry -l app.kubernetes.io/name=opentelemetry-collector
echo ""

# -------------------------------------------------------
# 6. Install cert-manager
# -------------------------------------------------------
echo "--- Installing cert-manager ---"
helm repo add jetstack https://charts.jetstack.io --force-update
helm repo update
if helm status cert-manager -n cert-manager &>/dev/null; then
  echo "cert-manager is already installed, skipping."
else
  helm upgrade --install cert-manager jetstack/cert-manager \
    --namespace cert-manager --create-namespace \
    --set crds.enabled=true \
    --wait
fi
echo "cert-manager pods:"
kubectl get pods -n cert-manager
echo ""

# -------------------------------------------------------
# 7. Install OpenTelemetry Operator
# -------------------------------------------------------
echo "--- Installing OpenTelemetry Operator ---"
if helm status opentelemetry-operator -n opentelemetry &>/dev/null; then
  echo "OpenTelemetry Operator is already installed, skipping."
else
  helm upgrade --install opentelemetry-operator open-telemetry/opentelemetry-operator \
    --namespace opentelemetry \
    --set manager.extraArgs='{--enable-go-instrumentation}' \
    --wait
fi
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
if helm status argocd -n argocd &>/dev/null; then
  echo "Argo CD is already installed, skipping."
else
  helm repo add argo https://argoproj.github.io/argo-helm 2>/dev/null || true
  helm repo update
  helm install argocd argo/argo-cd \
    --namespace argocd \
    --set server.service.type=ClusterIP \
    --wait
fi
echo "Argo CD pods:"
kubectl get pods -n argocd
echo ""

# -------------------------------------------------------
# 10. Install Argo Rollouts
# -------------------------------------------------------
echo "--- Installing Argo Rollouts ---"
kubectl create namespace argo-rollouts --dry-run=client -o yaml | kubectl apply -f -
if helm status argo-rollouts -n argo-rollouts &>/dev/null; then
  echo "Argo Rollouts is already installed, skipping."
else
  helm install argo-rollouts argo/argo-rollouts \
    --namespace argo-rollouts \
    --wait
fi
echo "Argo Rollouts pods:"
kubectl get pods -n argo-rollouts
echo ""

# -------------------------------------------------------
# 11. Deploy agents
# -------------------------------------------------------
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

# -------------------------------------------------------
# 12. Deploy application via Argo CD
# -------------------------------------------------------
echo "--- Configuring Argo CD Application ---"
kubectl apply -f "$PROJECT_ROOT/k8s-argocd/application.yaml"
echo "Argo CD Application 'reacting-to-ai' created. It will sync from k8s/ in the main branch."
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
echo "  Application:    http://localhost/"
echo "  Monitor Agent:  http://localhost/monitor/"
echo "  Fixer Agent:    http://localhost/fixer/"
echo "  Jaeger:         http://localhost/jaeger/ui"
echo "  Prometheus:     http://localhost/prometheus/"
echo "  Alertmanager:   http://localhost/alertmanager/"
echo "  Argo CD:        http://localhost/argocd/"
echo ""
echo "Argo CD credentials:"
echo "  Username: admin"
echo "  Password: kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d"
