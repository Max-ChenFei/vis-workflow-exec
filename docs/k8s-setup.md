# Kubernetes Setup Guide

## Overview

This guide helps you set up Argo Workflows on a local Kubernetes cluster for the **vis-workflow-exec** project. This setup provides the backend workflow execution engine that the React frontend connects to.

## Prerequisites

### Required Tools
- **Local Kubernetes cluster** (one of the following):
  - [Docker Desktop](https://www.docker.com/products/docker-desktop/) with Kubernetes enabled
  - [Minikube](https://minikube.sigs.k8s.io/docs/start/)
- **kubectl** configured and connected to your cluster

### Verify Prerequisites
```bash
# Verify kubectl connection
kubectl cluster-info

# Check cluster nodes
kubectl get nodes
```

## Quick Setup

### Automated Setup
Run the setup script to install and configure Argo Workflows:

```bash
bash setupDev.sh
```

**What this script does:**
- Creates the `argo` namespace in your Kubernetes cluster
- Installs Argo Workflows (v3.7.1)
- Configures RBAC permissions for workflow submission
- Sets up the Argo server in development mode (authentication disabled)
- Establishes port forwarding to access the Argo API locally

> **⚠️ Important**: Keep the terminal session open after running the script. The port forwarding will stop if you close it.

## Access Points

| Service | URL | Purpose |
|---------|-----|---------|
| Argo Workflows UI | http://localhost:2746 | Web interface for monitoring workflows |
| Argo API | http://localhost:2746/api/v1 | REST API endpoint for the React frontend |

## Configuration

### Development Mode Settings
- **Authentication**: Disabled (`--auth-mode=server`)
- **HTTPS**: Disabled (`--secure=false`)
- **Port**: 2746 (default Argo port)

## Verification

Check that everything is working:

```bash
# Check Argo installation
kubectl get pods -n argo

# Verify API access
curl http://localhost:2746/api/v1/workflows/argo
```

## Cleanup

To remove the Argo Workflows setup:

```bash
# Stop port forwarding
pkill -f "port-forward"

# Remove Argo Workflows
kubectl delete namespace argo
```
---

**Ready to develop! 🚀**