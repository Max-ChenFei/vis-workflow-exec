const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:2746',
      changeOrigin: true,
      secure: false,
      logLevel: 'debug'
    })
  );
};