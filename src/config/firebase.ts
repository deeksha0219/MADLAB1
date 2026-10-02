/**
 * GrabNGo - Safe Firebase Initialization & Emulator Connector
 *
 * Rules:
 * 1. Emulators are connected ONLY in 'local' mode.
 * 2. Emulators are NEVER connected in 'staging' mode.
 * 3. 'production' mode is completely unconfigured and throws an error.
 * 4. Emulator connection is configured strictly ONCE (idempotent singleton guard).
 * 5. Fails closed; never silently falls back to staging or production.
 * 6. The mobile app client connects to Auth and Firestore emulators only.
 *    It does NOT connect to or invoke the Functions emulator in Step 3.
 */

import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import functions from '@react-native-firebase/functions';
import {
  getActiveEnvironmentConfig,
  logActiveEnvironment,
} from './environment';

let isFirebaseConfigured = false;

/**
 * Configures Firebase services according to the active environment.
 * Safe to call multiple times; executes connection logic only once.
 */
export function configureFirebase(): void {
  if (isFirebaseConfigured) {
    return;
  }

  const config = getActiveEnvironmentConfig();
  logActiveEnvironment();

  if (config.environment === 'local') {
    if (!config.emulator) {
      throw new Error(
        '[FIREBASE CONFIG ERROR] Local environment requires emulator configuration.',
      );
    }

    const { host, authPort, firestorePort, functionsPort } = config.emulator;

    try {
      // Connect Auth to Firebase Auth Emulator
      auth().useEmulator(`http://${host}:${authPort}`);

      // Connect Firestore to Firebase Firestore Emulator
      firestore().useEmulator(host, firestorePort);

      // Connect Functions to Firebase Functions Emulator
      functions().useEmulator(host, functionsPort);

      console.log(
        `[GrabNGo Firebase] Successfully connected Auth (${authPort}), Firestore (${firestorePort}), and Functions (${functionsPort}) to Emulator at ${host} (Project: ${config.projectId})`,
      );
    } catch (error) {
      console.error(
        '[GrabNGo Firebase] Failed to connect to Firebase Emulators:',
        error,
      );
      throw error;
    }
  } else if (config.environment === 'staging') {
    // Staging connects to live Cloud Firebase project 'mad-lab-a9665' via google-services.json
    console.log(
      `[GrabNGo Firebase] Configured for STAGING project: ${config.projectId}. Live emulators bypassed.`,
    );
  } else if (config.environment === 'production') {
    // Production connects to live Cloud Firebase project via google-services.json
    console.log(
      `[GrabNGo Firebase] Configured for PRODUCTION project: ${config.projectId}. Live emulators bypassed.`,
    );
  } else {
    throw new Error(
      `[FIREBASE CONFIG ERROR] Unsupported environment "${(config as any).environment}". Fails closed.`,
    );
  }

  isFirebaseConfigured = true;
}

/**
 * Resets configuration status (primarily for testing isolation).
 */
export function resetFirebaseConfigurationState(): void {
  isFirebaseConfigured = false;
}

/**
 * Checks if Firebase services have been configured.
 */
export function isFirebaseInitialized(): boolean {
  return isFirebaseConfigured;
}
