# Development Setup Guide

## Prerequisites
- Docker Desktop with Kubernetes enabled
- kubectl configured and connected to your cluster

## Setup Instructions
Here we use `argo` namespace
**Argo Workflows Installation**
```bash
kubectl create namespace argo
kubectl apply -n argo -f https://github.com/argoproj/argo-workflows/releases/latest/download/install.yaml
```

Verify Installation
```bash
# Wait for all pods to be ready (this may take a few minutes)
kubectl get pods -n argo
# Check if argo-server is running
kubectl get deployment argo-server -n argo
```

**Setup Port Forwarding**
```bash
# Forward argo-server port to localhost
kubectl -n argo port-forward deployment/argo-server 2746:2746
```

> **Note**: Keep this terminal session open. The port forwarding will stop if you close it.

**RBAC Configuration (Roles & Service Accounts)**

RBAC (Role-Based Access Control) is required to allow the application to interact with Argo Workflows API securely.

1. Create Workflow Role

```bash
# Apply the role configuration
kubectl apply -f path/to/argo-workflow-role.yaml
```
Verify Role Creation
```bash
kubectl get role argo-workflow-role -n argo
```

2. Create Service Account and Bindings
```bash
# Apply the service account, role binding, and secret
kubectl apply -f path/to/argo-service-account.yaml
```
Verify RBAC Setup
```bash
# Check service account
kubectl get serviceaccount argo-workflow-api-user -n argo
# Check role binding
kubectl get rolebinding argo-workflow-api-user-binding -n argo
# Check secret (may take a moment to be created)
kubectl get secret argo-workflow-api-user-token -n argo
```

3. Token Generation

The token is required for API authentication with the Argo Workflows server.

* For Linux/macOS (Bash):
```bash
# Extract and format the token
ARGO_TOKEN="Bearer $(kubectl get secret argo-workflow-api-user-token -n argo -o=jsonpath='{.data.token}' | base64 --decode)"

# Display the token
echo $ARGO_TOKEN
```

* For Windows (PowerShell):
```powershell
# Get the base64 encoded token from the secret
$tokenBase64 = kubectl get secret argo-workflow-api-user-token -n argo -o jsonpath="{.data.token}"

# Decode the base64 token to plain text
$token = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($tokenBase64))

# Create the Bearer token
$ARGO_TOKEN = "Bearer $token"

# Display the Bearer token
Write-Output $ARGO_TOKEN
```

Token Verification
Your token should look like this:
```
Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6IjVRN....(long string)....MQ
```

## Access Argo UI

1. Open your browser and navigate to: **https://localhost:2746/**
2. Use the Bearer token generated above for authentication
3. You should now have access to the Argo Workflows UI

## Submit Workflows

When creating workflow manifests, ensure you use the created service account above:

```yaml
spec:
  serviceAccountName: argo-workflow-api-user
```

See `test/workflow_example.yaml` for a complete example.
