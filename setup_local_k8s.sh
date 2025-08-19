#!/bin/bash

# Argo Workflows Development Setup Script
# Sets up Argo Workflows with server mode authentication and local port forwarding

# Enable strict error handling
set -euo pipefail

echo "🚀 Starting Argo Workflows Development Setup..."
echo "================================================"

# Step 1: Create argo namespace
echo "📁 Setting up argo namespace..."
kubectl get ns argo >/dev/null 2>&1 || kubectl create ns argo
if kubectl get ns argo >/dev/null 2>&1; then
    echo "✓ Argo namespace ready"
else
    echo "✗ Failed to create argo namespace"
    exit 1
fi

# Step 2: Install Argo Workflows
echo "📦 Installing Argo Workflows..."
ARGO_VER=v3.7.1
kubectl apply -n argo -f https://github.com/argoproj/argo-workflows/releases/download/${ARGO_VER}/install.yaml

echo "⏳ Waiting for Argo components to be ready..."
kubectl wait --for=condition=available --timeout=300s deployment/argo-server -n argo
kubectl wait --for=condition=available --timeout=300s deployment/workflow-controller -n argo
echo "✓ Argo Workflows installed and ready"

# Step 3: Configure RBAC permissions
echo "🔐 Setting up RBAC permissions..."
kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: argo
  name: argo-workflow-submit-watch-role
rules:
- apiGroups: ["argoproj.io"]
  resources: ["workflows"]
  verbs: ["create", "get", "list", "watch"]
- apiGroups: ["argoproj.io"]
  resources: ["workflowtaskresults"]
  verbs: ["create", "get", "list", "watch", "patch"]
- apiGroups: [""]
  resources: ["pods/log"]
  verbs: ["get", "list"]
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: argo-default-submit-watch-binding
  namespace: argo
subjects:
- kind: ServiceAccount
  name: default
  namespace: argo
roleRef:
  kind: Role
  name: argo-workflow-submit-watch-role
  apiGroup: rbac.authorization.k8s.io
EOF
echo "✓ RBAC permissions configured"

# Step 4: Configure Argo server for development
echo "⚙️  Configuring Argo server for development..."
kubectl -n argo patch deploy argo-server --type='json' -p='[
  {"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--auth-mode=server"},
  {"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--secure=false"}
]' || kubectl -n argo patch deploy argo-server --type='json' -p='[
  {"op":"replace","path":"/spec/template/spec/containers/0/args","value":["server","--auth-mode=server","--secure=false"]}
]'

# Fix readiness probe for HTTP
kubectl patch deployment argo-server -n argo --type='json' -p='[
  {"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/scheme","value":"HTTP"}
]'

echo "⏳ Waiting for configuration to apply..."
kubectl rollout status deployment/argo-server -n argo --timeout=300s
echo "✓ Argo server configured for development mode"

# Step 5: Start port forwarding
echo "🌐 Setting up local access..."
kubectl -n argo port-forward deployment/argo-server 2746:2746 &
PORT_FORWARD_PID=$!
sleep 3

# Verify port-forward
if curl -s -f http://localhost:2746/ >/dev/null 2>&1; then
    echo "✓ Port forwarding established"
else
    echo "⚠️  Port forwarding may have issues, but continuing..."
fi

echo ""
echo "🎉 ARGO WORKFLOWS DEVELOPMENT SETUP SUCCESSFUL! 🎉"
echo "=================================================="
echo ""
echo "✅ Setup Complete! Your development environment is ready:"
echo ""
echo "🔌 Argo UI:        http://localhost:2746"
echo "🔌 API Endpoint:   http://localhost:2746/api/v1"
echo "🔑 Authentication: Disabled (server mode)"
echo "📝 RBAC:           Minimal permissions configured"
echo ""
echo "📋 Next Steps:"
echo "  • Submit workflows via the API"
echo ""
echo "⚡ Port-forward is running in background (PID: $PORT_FORWARD_PID)"
echo "   To stop: kill $PORT_FORWARD_PID"
echo ""
echo "Happy workflow development! 🚀"