# Frontend Development Setup Guide

## Overview

This guide helps you set up the React TypeScript frontend for the project. The frontend provides a visual interface for managing and monitoring Argo Workflows.

## Prerequisites

### Required Tools
- **Node.js** (v16 or higher)
- **npm** (comes with Node.js)

### Verify Prerequisites
```bash
# Verify Node.js installation
node --version
npm --version

# Should show versions like:
# v18.x.x or higher
# 9.x.x or higher
```

## Quick Setup

### 1. Clone Repository (if not already done)
```bash
git clone <repository-url>
cd vis-workflow-exec
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Start Development Server
```bash
npm start
```

The application will automatically open at [http://localhost:3000](http://localhost:3000).

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Runs the app in development mode with hot reload |
| `npm test` | Launches the test runner in interactive watch mode |
| `npm run build` | Builds the app for production |
| `npm run eject` | Ejects from Create React App (⚠️ one-way operation) |

## API Integration

### Connecting to Argo Workflows
The frontend connects to Argo Workflows via the REST API. Make sure you have:

1. **Argo Workflows running** (see [K8s Setup Guide](./k8s-setup.md))
2. **Port forwarding active** to http://localhost:2746
3. **Proxy configuration** (already set up in `setupProxy.js`)

## Development Configuration

### Proxy Setup
The project includes a proxy configuration (`src/setupProxy.js`) that forwards API requests to the Argo server:

```javascript
// Proxies /api/* requests to http://localhost:2746
```

## Troubleshooting

### Common Issues

**Port already in use (3000):**
```bash
# Find process using port 3000
netstat -ano | findstr :3000

# Kill the process (Windows)
taskkill /PID <PID> /F

# Or start on different port
set PORT=3001 && npm start
```

**API connection failed:**
```bash
# Verify Argo is running
curl http://localhost:2746/api/v1/version

# Check proxy configuration
# Review src/setupProxy.js
```

## Building for Production

### Production Build
```bash
npm run build
```

This creates an optimized build in the `build/` folder:
- **Minified** JavaScript and CSS
- **Optimized** assets with cache-busting hashes
- **Ready for deployment** to any static hosting service

## Next Steps

1. **Set up Argo Workflows** using the [K8s Setup Guide](./k8s-setup.md)
2. **Start developing** by exploring the `src/` directory
3. **Test the connection** by verifying the API integration works

---

**Happy coding! 🚀**