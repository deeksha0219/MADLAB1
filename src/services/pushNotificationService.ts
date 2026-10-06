/**
 * GrabNGo - Client-Side Push Notification & FCM Lifecycle Service (Phase 1 Additive)
 *
 * Security & Architectural Constraints:
 * 1. Push notifications are an additive delivery layer; in-app notifications remain the source of truth.
 * 2. Token registration is strictly performed via authenticated Cloud Function callable (registerPushToken).
 * 3. Direct Firestore writes to users/{userId}/pushTokens are STRICTLY PROHIBITED.
 * 4. Raw tokens are never logged or stored insecurely.
 * 5. Fails gracefully: permission denials, offline state, or missing Google Play Services
 *    NEVER degrade the core app experience or in-app notifications.
 */

import { Platform } from 'react-native';
import functions from '@react-native-firebase/functions';

export interface PushTokenRegistrationResult {
  readonly success: boolean;
  readonly tokenId?: string;
  readonly platform?: string;
  readonly error?: string;
}

export interface PushPreferences {
  readonly orderUpdates: boolean;
  readonly demoPaymentUpdates: boolean;
  readonly promotionalUpdates: boolean;
}

let activeTokenRefreshUnsubscribe: (() => void) | null = null;
let currentRegisteredTokenId: string | null = null;

/**
 * Requests push notification permissions from the host OS (Android 13+ / iOS).
 * Returns true if granted or provisional, false if denied.
 */
export async function requestPushPermission(): Promise<boolean> {
  try {
    const messagingModule = require('@react-native-firebase/messaging').default;
    const authStatus = await messagingModule().requestPermission();
    const enabled =
      authStatus === messagingModule.AuthorizationStatus.AUTHORIZED ||
      authStatus === messagingModule.AuthorizationStatus.PROVISIONAL;
    return enabled;
  } catch {
    // Non-fatal: permission request unavailable (e.g. Jest, unsupported platform)
    return false;
  }
}

/**
 * Retrieves the current device FCM token if permissions and Google Play Services / APNs are active.
 */
export async function getDeviceFcmToken(): Promise<string | null> {
  try {
    const messagingModule = require('@react-native-firebase/messaging').default;
    const hasPermission = await messagingModule().hasPermission();
    if (
      hasPermission !== messagingModule.AuthorizationStatus.AUTHORIZED &&
      hasPermission !== messagingModule.AuthorizationStatus.PROVISIONAL
    ) {
      return null;
    }
    const token = await messagingModule().getToken();
    return token || null;
  } catch {
    return null;
  }
}

/**
 * Registers the current device FCM token with the server for the authenticated user.
 */
export async function registerDevicePushToken(appVersion = '1.0.0'): Promise<PushTokenRegistrationResult> {
  try {
    const token = await getDeviceFcmToken();
    if (!token) {
      return { success: false, error: 'TOKEN_UNAVAILABLE' };
    }

    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    const callable = functions().httpsCallable('registerPushToken');
    const res = await callable({
      token,
      platform,
      appVersion,
    });

    const data = res.data as { success: boolean; tokenId: string; platform: string };
    if (data?.success) {
      currentRegisteredTokenId = data.tokenId;
    }

    // Set up token refresh listener if not already listening
    setupTokenRefreshListener(appVersion);

    return {
      success: true,
      tokenId: data?.tokenId,
      platform: data?.platform,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'REGISTRATION_FAILED',
    };
  }
}

/**
 * Listens for FCM token refresh events and updates server registration.
 */
export function setupTokenRefreshListener(appVersion = '1.0.0'): void {
  if (activeTokenRefreshUnsubscribe) {
    return; // Already listening
  }
  try {
    const messagingModule = require('@react-native-firebase/messaging').default;
    activeTokenRefreshUnsubscribe = messagingModule().onTokenRefresh(async (newToken: string) => {
      try {
        if (!newToken) return;
        const platform = Platform.OS === 'ios' ? 'ios' : 'android';
        const callable = functions().httpsCallable('registerPushToken');
        const res = await callable({
          token: newToken,
          platform,
          appVersion,
        });
        const data = res.data as { success: boolean; tokenId: string };
        if (data?.success) {
          currentRegisteredTokenId = data.tokenId;
        }
      } catch {
        // Non-fatal background refresh retry will trigger on next app start
      }
    });
  } catch {
    // Non-fatal: running in environment without messaging native module
  }
}

/**
 * Unregisters the current device token on user logout.
 */
export async function unregisterDevicePushToken(): Promise<{ success: boolean }> {
  try {
    if (activeTokenRefreshUnsubscribe) {
      activeTokenRefreshUnsubscribe();
      activeTokenRefreshUnsubscribe = null;
    }

    const token = await getDeviceFcmToken();
    const callable = functions().httpsCallable('unregisterPushToken');

    if (currentRegisteredTokenId) {
      await callable({ tokenId: currentRegisteredTokenId });
      currentRegisteredTokenId = null;
    } else if (token) {
      await callable({ token });
    }

    // Also attempt native SDK token deletion if supported
    try {
      const messagingModule = require('@react-native-firebase/messaging').default;
      await messagingModule().deleteToken();
    } catch {}

    return { success: true };
  } catch {
    // Non-fatal: logout should proceed regardless of push unregistration status
    return { success: false };
  }
}

/**
 * Fetches user push preferences from server callable.
 */
export async function fetchPushPreferences(): Promise<PushPreferences> {
  try {
    const callable = functions().httpsCallable('getPushNotificationPreferences');
    const res = await callable({});
    return (res.data as any)?.preferences || {
      orderUpdates: true,
      demoPaymentUpdates: true,
      promotionalUpdates: false,
    };
  } catch {
    return {
      orderUpdates: true,
      demoPaymentUpdates: true,
      promotionalUpdates: false,
    };
  }
}

/**
 * Updates user push preferences via server callable.
 */
export async function updatePushPreferences(prefs: Partial<PushPreferences>): Promise<boolean> {
  try {
    const callable = functions().httpsCallable('setPushNotificationPreferences');
    await callable(prefs);
    return true;
  } catch {
    return false;
  }
}
