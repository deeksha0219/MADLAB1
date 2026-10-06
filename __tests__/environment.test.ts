import {
  resolveEnvironmentConfig,
  getActiveEnvironmentConfig,
  setActiveEnvironment,
} from '../src/config/environment';

describe('GrabNGo - Environment Configuration Security Foundation', () => {
  afterEach(() => {
    // Reset to safe default
    setActiveEnvironment('local');
  });

  test('default active environment is "local" targeting Firebase Emulator Suite with demo project', () => {
    const config = getActiveEnvironmentConfig();
    expect(config.environment).toBe('local');
    expect(config.projectId).toBe('demo-grabngo-local');
    expect(config.useEmulator).toBe(true);
    expect(config.clientCallsFunctionsEmulator).toBe(true);
    expect(config.emulator).toBeDefined();
    expect(config.emulator?.authPort).toBe(9099);
    expect(config.emulator?.firestorePort).toBe(8085);
    expect(config.emulator?.functionsPort).toBe(5001);
  });

  test('staging environment targets staging project and disables emulators', () => {
    const config = resolveEnvironmentConfig('staging');
    expect(config.environment).toBe('staging');
    expect(config.projectId).toBe('mad-lab-a9665');
    expect(config.useEmulator).toBe(false);
    expect(config.clientCallsFunctionsEmulator).toBe(false);
  });

  test('production environment targets production project and strictly disables emulators', () => {
    const config = resolveEnvironmentConfig('production');
    expect(config.environment).toBe('production');
    expect(config.projectId).toBe('grabngo-production');
    expect(config.useEmulator).toBe(false);
    expect(config.emulator).toBeUndefined();
    expect(config.clientCallsFunctionsEmulator).toBe(false);
    expect(config.enableDebugLogs).toBe(false);
  });

  test('production environment rejects local operator token minting', () => {
    const origEnv = process.env.ENABLE_LOCAL_OPERATOR_TOKEN_MINTING;
    try {
      process.env.ENABLE_LOCAL_OPERATOR_TOKEN_MINTING = 'true';
      expect(() => {
        resolveEnvironmentConfig('production');
      }).toThrow(/Production build cannot use local operator token minting/);
    } finally {
      process.env.ENABLE_LOCAL_OPERATOR_TOKEN_MINTING = origEnv;
    }
  });

  test('rejects unknown environment strings (fails closed)', () => {
    expect(() => {
      resolveEnvironmentConfig('invalid-env-name');
    }).toThrow(/Unknown environment/);
  });
});
