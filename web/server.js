const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const PORT = 5050;
const BIND_HOST = '127.0.0.1'; // MUST bind strictly to loopback (never 0.0.0.0)
const PROJECT_ID = 'demo-grabngo-local';
const AUTH_PORT = 9099;

let admin;
try {
  admin = require(path.resolve(__dirname, '../functions/node_modules/firebase-admin'));
} catch (_err) {
  admin = require('firebase-admin');
}

if (!admin.apps.length) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || `127.0.0.1:${AUTH_PORT}`;
  process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
  admin.initializeApp({ projectId: PROJECT_ID });
}

// Ensure service desk test account definition
const TEST_OPERATOR = {
  uid: '0PSMEvTEJbgDo5xCX2BDI3waI0Re',
  phone: '+919999999999',
  role: 'service_desk',
  name: 'Service Desk Operator',
  canteenIds: ['BIG_MINGOS', 'LIBRARY_CANTEEN']
};

/**
 * Mint an operator ID token against the Firebase Auth Emulator.
 */
async function getOperatorIdToken() {
  const customToken = await admin.auth().createCustomToken(TEST_OPERATOR.uid, {
    role: TEST_OPERATOR.role,
    canteenIds: TEST_OPERATOR.canteenIds
  });

  const res = await axios.post(
    `http://127.0.0.1:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake-key`,
    { token: customToken, returnSecureToken: true }
  );

  return res.data.idToken;
}

/**
 * SEC-01: Fail-closed authorization guard for /api/token.
 *
 * MUST fail closed unless ALL of the following are true:
 * 1. Firebase Auth emulator is explicitly enabled (FIREBASE_AUTH_EMULATOR_HOST is set).
 * 2. The server process binds strictly to 127.0.0.1 loopback (not 0.0.0.0 or public interface).
 * 3. A development-only flag is present (ALLOW_EMULATOR_DEV_TOKEN=true or NODE_ENV=development).
 * 4. NODE_ENV is NOT 'staging', 'production', or 'prod'.
 * 5. Incoming request client IP is a local loopback address.
 */
function isOperatorTokenRouteAuthorized(options = {}) {
  const env = options.env || process.env;
  const boundHost = options.boundHost || BIND_HOST;
  const remoteAddress = options.remoteAddress || '127.0.0.1';

  // 1. Firebase Auth emulator must be explicitly enabled
  const authEmulator = env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!authEmulator || authEmulator.trim().length === 0) {
    return { authorized: false, reason: 'Firebase Auth emulator is not enabled' };
  }

  // 2. Bound host must be strictly loopback (127.0.0.1 or localhost)
  const isLoopbackHost = boundHost === '127.0.0.1' || boundHost === 'localhost';
  if (!isLoopbackHost) {
    return { authorized: false, reason: `Server is bound to non-loopback interface (${boundHost})` };
  }

  // 3. Development-only flag must be explicitly active
  const isDevFlagPresent = env.ENABLE_LOCAL_OPERATOR_TOKEN_MINTING === 'true';
  if (!isDevFlagPresent) {
    return { authorized: false, reason: 'ENABLE_LOCAL_OPERATOR_TOKEN_MINTING is absent or false' };
  }

  // 4. NODE_ENV and GRABNGO_ENV must NOT be staging or production
  const nodeEnv = (env.NODE_ENV || '').toLowerCase().trim();
  if (nodeEnv === 'staging' || nodeEnv === 'production' || nodeEnv === 'prod') {
    return { authorized: false, reason: `Minting operator tokens is strictly forbidden in environment: ${nodeEnv}` };
  }
  const grabngoEnv = (env.GRABNGO_ENV || '').toLowerCase().trim();
  if (grabngoEnv === 'staging' || grabngoEnv === 'production') {
    return { authorized: false, reason: `Minting operator tokens is strictly forbidden in GRABNGO_ENV: ${grabngoEnv}` };
  }

  // 5. Remote client IP must be loopback
  const isLoopbackClient = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
  if (!isLoopbackClient) {
    return { authorized: false, reason: `Client IP (${remoteAddress}) is not a loopback address` };
  }

  return { authorized: true };
}

function createServiceDeskServer(options = {}) {
  const serverBindHost = options.bindHost || BIND_HOST;

  const appServer = http.createServer(async (req, res) => {
    // CORS: Strict localhost / 127.0.0.1 loopback origin policy (never wildcard)
    const origin = req.headers.origin;
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Parse URL safely to handle query params and malformed requests
    let parsedUrl;
    try {
      parsedUrl = new URL(req.url, 'http://127.0.0.1');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Malformed request URL.' }));
      return;
    }

    // SEC-01 Protected API endpoint: /api/token
    if (parsedUrl.pathname === '/api/token') {
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          error: `Method Not Allowed. Only GET is supported for /api/token (received ${req.method}).`
        }));
        return;
      }

      const clientIp = req.socket.remoteAddress || (req.connection && req.connection.remoteAddress) || '127.0.0.1';
      const authCheck = isOperatorTokenRouteAuthorized({
        env: options.env || process.env,
        boundHost: serverBindHost,
        remoteAddress: clientIp
      });

      if (!authCheck.authorized) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          error: `Forbidden: ${authCheck.reason}. Operator token route is restricted to local emulator development.`
        }));
        return;
      }

      try {
        const idToken = await getOperatorIdToken();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          idToken,
          operator: TEST_OPERATOR
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Static file serving with strict path traversal validation
    const rawUrl = req.url || '';
    if (rawUrl.includes('..') || rawUrl.toLowerCase().includes('%2e')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden: Path traversal detected.');
      return;
    }

    const rawPath = parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname.replace(/^\/+/, '');
    const resolvedPath = path.resolve(__dirname, rawPath);
    const normalizedDir = path.resolve(__dirname);

    if (!resolvedPath.startsWith(normalizedDir + path.sep) && resolvedPath !== path.join(normalizedDir, 'index.html')) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden: Path traversal detected.');
      return;
    }

    const ext = path.extname(resolvedPath);

    const contentTypeMap = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml'
    };

    const contentType = contentTypeMap[ext] || 'text/plain';

    fs.readFile(resolvedPath, (err, content) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('404 Not Found');
        } else {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end(`Server Error: ${err.code}`);
        }
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });
  });

  return appServer;
}

const server = createServiceDeskServer({ bindHost: BIND_HOST });

// Automatically listen when executed directly
if (require.main === module) {
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  if (process.env.ENABLE_LOCAL_OPERATOR_TOKEN_MINTING !== 'true') {
    console.log('[GrabNGo Service Desk Web] Notice: ENABLE_LOCAL_OPERATOR_TOKEN_MINTING is not enabled. Operator token endpoint disabled.');
  }

  server.listen(PORT, BIND_HOST, () => {
    console.log(`[GrabNGo Service Desk Web] Running securely on http://${BIND_HOST}:${PORT} (Local emulator harness)`);
  });
}

module.exports = {
  server,
  createServiceDeskServer,
  isOperatorTokenRouteAuthorized,
  getOperatorIdToken,
  TEST_OPERATOR,
  BIND_HOST,
  PORT
};
