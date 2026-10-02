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

export type AppEnvironment = 'local' | 'staging';

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

/**
 * Global __DEV__ flag provided by React Native bundler.
 * In development builds, default to 'local' for offline emulator safety.
 * In production/release builds, default to 'staging' (or fail if production requested).
 */
declare const __DEV__: boolean | undefined;
const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : true;

/**
 * Current environment selection.
 * Defaults to 'local' in development. Can be toggled programmatically via setActiveEnvironment().
 */
let currentEnvironment: AppEnvironment = isDev ? 'local' : 'staging';

/**
 * Validates and resolves the active environment configuration.
 * Fails closed: rejects 'production' and any unknown environment string.
 * Never silently falls back to staging or production.
 */
export function resolveEnvironmentConfig(envName: string): EnvironmentConfig {
  if (envName === 'production') {
    throw new Error(
      '[SECURITY ERROR] Production environment is not configured in this project. All requests rejected.',
    );
  }

  if (envName === 'local') {
    return LOCAL_CONFIG;
  }

  if (envName === 'staging') {
    return STAGING_CONFIG;
  }

  throw new Error(
    `[CONFIG ERROR] Unknown environment "${envName}". Allowed values: 'local' | 'staging'. Fails closed.`,
  );
}

/**
 * Gets the active environment configuration object.
 */
export function getActiveEnvironmentConfig(): EnvironmentConfig {
  return resolveEnvironmentConfig(currentEnvironment);
}

/**
 * Sets the active environment. Rejects invalid environments, production,
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
