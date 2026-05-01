#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OBSERVABILITY_DIR="$PROJECT_ROOT/k8s-observability"

CLUSTER_NAME="${KIND_CLUSTER_NAME:-reacting-to-ai}"

echo "=== Reacting to AI - Cluster & Observability Setup ==="
echo ""

# -------------------------------------------------------
# 1. Create KinD cluster
# -------------------------------------------------------
echo "--- Creating KinD cluster: $CLUSTER_NAME ---"
if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
  echo "Cluster '$CLUSTER_NAME' already exists, skipping creation."
else
  kind create cluster --name "$CLUSTER_NAME" --wait 5m
fi
kubectl cluster-info --context "kind-${CLUSTER_NAME}"
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
# 10. Deploy application via Argo CD
# -------------------------------------------------------
echo "--- Configuring Argo CD Application ---"
kubectl apply -f "$PROJECT_ROOT/k8s-argocd/application.yaml"
echo "Argo CD Application 'reacting-to-ai' created. It will sync from k8s/ in the main branch."
echo ""

echo "=== Cluster & Observability setup complete ==="
echo ""
echo "Cluster: $CLUSTER_NAME"
echo ""
echo "To access Jaeger UI:"
echo "  kubectl port-forward svc/jaeger-query 16686"
echo "  Then open http://localhost:16686"
echo ""
echo "To access Prometheus UI:"
echo "  kubectl port-forward svc/prometheus-kube-prometheus-prometheus -n monitoring 9090"
echo "  Then open http://localhost:9090"
echo ""
echo "To access Alertmanager UI:"
echo "  kubectl port-forward svc/prometheus-kube-prometheus-alertmanager -n monitoring 9093"
echo "  Then open http://localhost:9093"
echo ""
echo "To access Argo CD UI:"
echo "  kubectl port-forward svc/argocd-server -n argocd 8443:443"
echo "  Then open https://localhost:8443"
echo "  Username: admin"
echo "  Password: kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d"
