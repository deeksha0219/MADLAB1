import http from 'http';
const {
  isOperatorTokenRouteAuthorized,
  createServiceDeskServer,
} = require('../../web/server');

describe('SEC-01: Operator Token Route Security & Boundary Invariants', () => {
  const baseValidEnv = {
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    ENABLE_LOCAL_OPERATOR_TOKEN_MINTING: 'true',
    NODE_ENV: 'development',
  };

  test('Local emulator-only behavior works when all required conditions are met', () => {
    const result = isOperatorTokenRouteAuthorized({
      env: baseValidEnv,
      boundHost: '127.0.0.1',
      remoteAddress: '127.0.0.1',
    });
    expect(result.authorized).toBe(true);
  });

  test('The route is DENIED when Firebase Auth emulator mode is false or missing', () => {
    const resultNoEmulator = isOperatorTokenRouteAuthorized({
      env: { ...baseValidEnv, FIREBASE_AUTH_EMULATOR_HOST: '' },
      boundHost: '127.0.0.1',
      remoteAddress: '127.0.0.1',
    });
    expect(resultNoEmulator.authorized).toBe(false);
    expect(resultNoEmulator.reason).toMatch(/Firebase Auth emulator is not enabled/);
  });

  test('The route is DENIED in staging mode', () => {
    const resultStaging = isOperatorTokenRouteAuthorized({
      env: { ...baseValidEnv, NODE_ENV: 'staging' },
      boundHost: '127.0.0.1',
      remoteAddress: '127.0.0.1',
    });
    expect(resultStaging.authorized).toBe(false);
    expect(resultStaging.reason).toMatch(/strictly forbidden in environment: staging/);
  });

  test('The route is DENIED in production mode', () => {
    const resultProd = isOperatorTokenRouteAuthorized({
      env: { ...baseValidEnv, NODE_ENV: 'production' },
      boundHost: '127.0.0.1',
      remoteAddress: '127.0.0.1',
    });
    expect(resultProd.authorized).toBe(false);
    expect(resultProd.reason).toMatch(/strictly forbidden in environment: production/);
  });

  test('The route is DENIED when ENABLE_LOCAL_OPERATOR_TOKEN_MINTING is absent or false', () => {
    const resultNoFlag = isOperatorTokenRouteAuthorized({
      env: {
        FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
        NODE_ENV: 'development',
      },
      boundHost: '127.0.0.1',
      remoteAddress: '127.0.0.1',
    });
    expect(resultNoFlag.authorized).toBe(false);
    expect(resultNoFlag.reason).toMatch(/ENABLE_LOCAL_OPERATOR_TOKEN_MINTING is absent or false/);

    const resultFalseFlag = isOperatorTokenRouteAuthorized({
      env: {
        ...baseValidEnv,
        ENABLE_LOCAL_OPERATOR_TOKEN_MINTING: 'false',
      },
      boundHost: '127.0.0.1',
      remoteAddress: '127.0.0.1',
    });
    expect(resultFalseFlag.authorized).toBe(false);
    expect(resultFalseFlag.reason).toMatch(/ENABLE_LOCAL_OPERATOR_TOKEN_MINTING is absent or false/);
  });

  test('The route is DENIED when server binds to a non-loopback address (0.0.0.0 or public)', () => {
    const resultWildcard = isOperatorTokenRouteAuthorized({
      env: baseValidEnv,
      boundHost: '0.0.0.0',
      remoteAddress: '127.0.0.1',
    });
    expect(resultWildcard.authorized).toBe(false);
    expect(resultWildcard.reason).toMatch(/Server is bound to non-loopback/);

    const resultPublic = isOperatorTokenRouteAuthorized({
      env: baseValidEnv,
      boundHost: '192.168.1.100',
      remoteAddress: '127.0.0.1',
    });
    expect(resultPublic.authorized).toBe(false);
  });

  test('The route is DENIED when client IP originates from non-loopback address', () => {
    const resultExternalClient = isOperatorTokenRouteAuthorized({
      env: baseValidEnv,
      boundHost: '127.0.0.1',
      remoteAddress: '192.168.1.55',
    });
    expect(resultExternalClient.authorized).toBe(false);
    expect(resultExternalClient.reason).toMatch(/Client IP .* is not a loopback address/);
  });

  describe('HTTP Methods, Malformed Requests & Token Absence Verification', () => {
    let testServer: http.Server;

    afterEach((done) => {
      if (testServer && testServer.listening) {
        testServer.close(done);
      } else {
        done();
      }
    });

    function request(serverInstance: http.Server, options: http.RequestOptions, bodyData?: string): Promise<{ statusCode: number, headers: http.IncomingHttpHeaders, body: string }> {
      return new Promise((resolve, reject) => {
        const addr = serverInstance.address() as any;
        const req = http.request({
          hostname: '127.0.0.1',
          port: addr.port,
          ...options,
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            resolve({ statusCode: res.statusCode || 0, headers: res.headers, body: data });
          });
        });
        req.on('error', reject);
        if (bodyData) {
          req.write(bodyData);
        }
        req.end();
      });
    }

    test('OPTIONS /api/token returns 204 No Content with zero body or token', async () => {
      testServer = createServiceDeskServer({ bindHost: '127.0.0.1', env: baseValidEnv });
      await new Promise<void>((resolve) => testServer.listen(0, '127.0.0.1', resolve));

      const res = await request(testServer, { path: '/api/token', method: 'OPTIONS' });
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
      expect(res.body).not.toContain('token');
    });

    test('POST /api/token is rejected with 405 Method Not Allowed and NO token', async () => {
      testServer = createServiceDeskServer({ bindHost: '127.0.0.1', env: baseValidEnv });
      await new Promise<void>((resolve) => testServer.listen(0, '127.0.0.1', resolve));

      const res = await request(testServer, {
        path: '/api/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, JSON.stringify({ role: 'operator' }));

      expect(res.statusCode).toBe(405);
      const parsed = JSON.parse(res.body);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toContain('Method Not Allowed');
      expect(parsed.idToken).toBeUndefined();
      expect(parsed.customToken).toBeUndefined();
    });

    test('Unsupported methods (PUT, DELETE) are rejected with 405 Method Not Allowed and NO token', async () => {
      testServer = createServiceDeskServer({ bindHost: '127.0.0.1', env: baseValidEnv });
      await new Promise<void>((resolve) => testServer.listen(0, '127.0.0.1', resolve));

      for (const method of ['PUT', 'DELETE']) {
        const res = await request(testServer, { path: '/api/token', method });
        expect(res.statusCode).toBe(405);
        const parsed = JSON.parse(res.body);
        expect(parsed.ok).toBe(false);
        expect(parsed.idToken).toBeUndefined();
      }
    });

    test('Malformed query string requests to /api/token fail closed or parse safely', async () => {
      testServer = createServiceDeskServer({
        bindHost: '127.0.0.1',
        env: { ...baseValidEnv, NODE_ENV: 'staging' }, // Staging denial
      });
      await new Promise<void>((resolve) => testServer.listen(0, '127.0.0.1', resolve));

      const res = await request(testServer, { path: '/api/token?malformed=%FF&injected=true', method: 'GET' });
      expect(res.statusCode).toBe(403);
      const parsed = JSON.parse(res.body);
      expect(parsed.ok).toBe(false);
      expect(parsed.idToken).toBeUndefined();
    });

    test('HTTP GET /api/token returns 403 Forbidden with NO token when environment is staging', async () => {
      testServer = createServiceDeskServer({
        bindHost: '127.0.0.1',
        env: {
          ...baseValidEnv,
          NODE_ENV: 'staging',
        },
      });
      await new Promise<void>((resolve) => testServer.listen(0, '127.0.0.1', resolve));

      const res = await request(testServer, { path: '/api/token', method: 'GET' });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('Forbidden');
      expect(body.idToken).toBeUndefined();
    });

    test('HTTP GET /api/token returns 403 Forbidden with NO token when bound to 0.0.0.0', async () => {
      testServer = createServiceDeskServer({
        bindHost: '0.0.0.0',
        env: baseValidEnv,
      });
      await new Promise<void>((resolve) => testServer.listen(0, '127.0.0.1', resolve));

      const res = await request(testServer, { path: '/api/token', method: 'GET' });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('Server is bound to non-loopback');
      expect(body.idToken).toBeUndefined();
    });

    test('Non-existent alternate token routes (/api/token/operator, /operator/token) return 404', async () => {
      testServer = createServiceDeskServer({ bindHost: '127.0.0.1', env: baseValidEnv });
      await new Promise<void>((resolve) => testServer.listen(0, '127.0.0.1', resolve));

      const altRoutes = ['/api/token/operator', '/operator/token', '/api/tokens', '/token'];
      for (const route of altRoutes) {
        const res = await request(testServer, { path: route, method: 'GET' });
        expect(res.statusCode).toBe(404);
        expect(res.body).not.toContain('idToken');
      }
    });
  });
});
