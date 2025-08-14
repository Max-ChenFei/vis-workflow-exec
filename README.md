# vis-workflow-exec

A React TypeScript application that provides a visual interface for managing and monitoring Argo Workflows.

## Quick Start

### Prerequisites
- Local Kubernetes cluster with Argo Workflows
- Node.js (v16+) and npm

### Setup
1. **Backend Setup**: Follow the [Kubernetes & Argo Setup Guide](./docs/k8s-setup.md)
2. **Frontend Setup**: Follow the [Frontend Development Guide](./docs/frontend-setup.md)

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)

## Project Overview

This React TypeScript application provides a visual interface for Argo Workflows, enabling:

- **Workflow Management**: Submit, monitor, and manage workflow executions
- **Real-time Updates**: Live monitoring of workflow status and logs
- **Visual Interface**: User-friendly UI for complex workflow operations
- **API Integration**: Direct integration with Argo Workflows REST API

## Documentation

- 📚 [Kubernetes & Argo Setup Guide](./docs/k8s-setup.md) - Set up the backend infrastructure
- 🔧 [Frontend Development Guide](./docs/frontend-setup.md) - Set up the React development environment
- 📝 [Workflow Examples](./test/) - Sample workflows for testing

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   React App     │    │   Argo Server    │    │   Kubernetes    │
│  (Frontend)     │◄──►│   (REST API)     │◄──►│   (Workflows)   │
│  localhost:3000 │    │  localhost:2746  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Contributing

1. Follow the setup guides to prepare your development environment
2. Make changes and test locally
3. Submit a pull request with clear description of changes

---

**Built with React + TypeScript + Argo Workflows**
