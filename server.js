import http from 'http';
import handler from './api/index.js';

const PORT = process.env.PORT || 7860;

/**
 * Decorates standard Node.js ServerResponse with lightweight Express/Vercel helper methods.
 */
function wrapResponse(res) {
  if (!res.status) {
    res.status = function (code) {
      this.statusCode = code;
      return this;
    };
  }
  if (!res.json) {
    res.json = function (data) {
      this.setHeader('Content-Type', 'application/json; charset=utf-8');
      this.end(JSON.stringify(data));
      return this;
    };
  }
  if (!res.send) {
    res.send = function (body) {
      this.end(body);
      return this;
    };
  }
  if (!res.redirect) {
    res.redirect = function (status, url) {
      const targetUrl = typeof status === 'string' ? status : url;
      const targetStatus = typeof status === 'number' ? status : 307;
      this.statusCode = targetStatus;
      this.setHeader('Location', targetUrl);
      this.end();
      return this;
    };
  }
  return res;
}

const server = http.createServer((req, res) => {
  wrapResponse(res);

  // Normalize query parameters from URL for Vercel handler compatibility
  const host = req.headers.host || 'localhost';
  const urlObj = new URL(req.url, `http://${host}`);
  req.query = Object.fromEntries(urlObj.searchParams.entries());

  handler(req, res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ImageEngine running on port ${PORT}`);
});
