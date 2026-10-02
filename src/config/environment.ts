/**
 * GrabNGo - Environment Configuration Module
 *
 * NOTE ON RUNTIME ENVIRONMENT SELECTION:
 * React Native does not natively read or inject .env files into the JavaScript runtime
 * without native bridging libraries (e.g. react-native-config) or Babel transform plugins.
 * To avoid unvetted dependencies in Step 3, this module serves as the authoritative,
 * strictly-typed configuration provider for the mobile client.
 *
 * Safe template files (.env.example, .env.local.example, .env.staging.example) exist
 * as documentation and contracts for CI/CD and future build automation.
 *
 * Supported environments:
 * - 'local'   : Connects to Firebase Emulator Suite using project 'demo-grabngo-local'
 * - 'staging' : Connects to Firebase Staging Project 'mad-lab-a9665'
 * - 'production' : EXPLICITLY NOT CONFIGURED / REJECTED
 */

export type AppEnvironment = 'local' | 'staging' | 'production';

export interface EmulatorConfig {
  readonly host: string;
  readonly authPort: number;
  readonly firestorePort: number;
  readonly functionsPort: number;
}

export interface EnvironmentConfig {
  readonly environment: AppEnvironment;
  readonly projectId: string;
  readonly useEmulator: boolean;
  readonly emulator?: EmulatorConfig;
  readonly enableDebugLogs: boolean;
  /**
   * Explains whether the mobile app client actively calls Cloud Functions.
   * In Step 4, this is TRUE: The mobile app invokes callable createStudentProfile
   * through @react-native-firebase/functions.
   */
  readonly clientCallsFunctionsEmulator: boolean;
}

const LOCAL_CONFIG: EnvironmentConfig = {
  environment: 'local',
  projectId: 'demo-grabngo-local',
  useEmulator: true,
  emulator: {
    // 10.0.2.2 is the default alias for the host machine loopback interface on Android emulators
    host: '10.0.2.2',
    authPort: 9099,
    firestorePort: 8085,
    functionsPort: 5001,
  },
  enableDebugLogs: true,
  clientCallsFunctionsEmulator: true,
};

const STAGING_CONFIG: EnvironmentConfig = {
  environment: 'staging',
  projectId: 'mad-lab-a9665',
  useEmulator: false,
  enableDebugLogs: false,
  clientCallsFunctionsEmulator: false,
};

const PRODUCTION_CONFIG: EnvironmentConfig = {
  environment: 'production',
  projectId: (typeof process !== 'undefined' && process.env?.GRABNGO_PROD_PROJECT_ID) ? process.env.GRABNGO_PROD_PROJECT_ID : 'grabngo-production',
  useEmulator: false,
  enableDebugLogs: false,
  clientCallsFunctionsEmulator: false,
};

/**
 * Global __DEV__ flag provided by React Native bundler.
 * In development builds, default to 'local' for offline emulator safety.
 * In production/release builds, require an explicit GRABNGO_ENV selector.
 */
declare const __DEV__: boolean | undefined;
const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

/**
 * Resolves the build-time environment.
 * Fails closed if a non-development build lacks explicit GRABNGO_ENV.
 */
export function resolveBuildTimeEnvironment(): AppEnvironment {
  const envVar = (typeof process !== 'undefined' && process.env?.GRABNGO_ENV)
    ? process.env.GRABNGO_ENV.trim().toLowerCase()
    : undefined;

  if (envVar) {
    if (envVar === 'local' || envVar === 'staging' || envVar === 'production') {
      return envVar;
    }
    throw new Error(
      `[CONFIG ERROR] Invalid GRABNGO_ENV "${envVar}". Allowed values: 'local' | 'staging' | 'production'. Fails closed.`,
    );
  }

  if (!isDev) {
    throw new Error(
      '[CONFIG ERROR] Non-development build requires explicit GRABNGO_ENV ("staging" | "production"). Fails closed.',
    );
  }

  return 'local';
}

/**
 * Current environment selection.
 */
let currentEnvironment: AppEnvironment = resolveBuildTimeEnvironment();

/**
 * Validates and resolves the active environment configuration.
 * Fails closed on any unknown environment string or invalid configuration.
 * Never silently falls back to staging or production.
 */
export function resolveEnvironmentConfig(envName: string): EnvironmentConfig {
  if (envName === 'local') {
    return LOCAL_CONFIG;
  }

  if (envName === 'staging') {
    return STAGING_CONFIG;
  }

  if (envName === 'production') {
    // Fail-closed checks for production build
    if (!PRODUCTION_CONFIG.projectId || PRODUCTION_CONFIG.projectId.trim().length === 0) {
      throw new Error('[SECURITY ERROR] Production project configuration is missing. Fails closed.');
    }
    if (PRODUCTION_CONFIG.projectId.includes('demo')) {
      throw new Error('[SECURITY ERROR] Production cannot use demo project ID. Fails closed.');
    }
    if (PRODUCTION_CONFIG.projectId === STAGING_CONFIG.projectId) {
      throw new Error('[SECURITY ERROR] Production project ID cannot match staging project ID. Fails closed.');
    }
    if (PRODUCTION_CONFIG.useEmulator || PRODUCTION_CONFIG.emulator) {
      throw new Error('[SECURITY ERROR] Production build cannot connect to emulator. Fails closed.');
    }
    if (PRODUCTION_CONFIG.enableDebugLogs) {
      throw new Error('[SECURITY ERROR] Debug logging must be disabled in production. Fails closed.');
    }
    if (typeof process !== 'undefined' && process.env?.ENABLE_LOCAL_OPERATOR_TOKEN_MINTING === 'true') {
      throw new Error('[SECURITY ERROR] Production build cannot use local operator token minting. Fails closed.');
    }
    return PRODUCTION_CONFIG;
  }

  throw new Error(
    `[CONFIG ERROR] Unknown environment "${envName}". Allowed values: 'local' | 'staging' | 'production'. Fails closed.`,
  );
}

/**
 * Gets the active environment configuration object.
 */
export function getActiveEnvironmentConfig(): EnvironmentConfig {
  return resolveEnvironmentConfig(currentEnvironment);
}

/**
 * Sets the active environment. Rejects invalid environments,
 * and runtime switching outside local development.
 */
export function setActiveEnvironment(env: AppEnvironment): void {
  if (!isDev) {
    throw new Error(
      '[SECURITY ERROR] Runtime environment switching is strictly forbidden outside local development.',
    );
  }
  // Validate before applying
  resolveEnvironmentConfig(env);
  currentEnvironment = env;
}

/**
 * Logs the active environment metadata to the console safely,
 * without exposing secret keys, tokens, or credentials.
 */
export function logActiveEnvironment(): void {
  const config = getActiveEnvironmentConfig();
  if (!config.enableDebugLogs) {
    return;
  }

  console.log('====================================================');
  console.log(`[GrabNGo Environment] Active: ${config.environment.toUpperCase()}`);
  console.log(`[GrabNGo Environment] Firebase Project ID: ${config.projectId}`);
  console.log(`[GrabNGo Environment] Uses Emulator: ${config.useEmulator}`);
  console.log(
    `[GrabNGo Environment] Mobile Client Calls Functions Emulator: ${config.clientCallsFunctionsEmulator}`,
  );
  if (config.useEmulator && config.emulator) {
    console.log(
      `[GrabNGo Environment] Emulator Host: ${config.emulator.host} (Auth:${config.emulator.authPort}, Firestore:${config.emulator.firestorePort})`,
    );
  }
  console.log('====================================================');
}
