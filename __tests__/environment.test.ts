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

  test('rejects production environment with a security error (never falls back)', () => {
    expect(() => {
      resolveEnvironmentConfig('production');
    }).toThrow(/Production environment is not configured/);
  });

  test('rejects unknown environment strings (fails closed)', () => {
    expect(() => {
      resolveEnvironmentConfig('invalid-env-name');
    }).toThrow(/Unknown environment/);
  });
});
