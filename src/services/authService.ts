/**
 * GrabNGo - Student & Staff Authentication Service
 *
 * Rules:
 * 1. Normalizes phone numbers strictly to E.164 (+91XXXXXXXXXX).
 * 2. Does NOT perform client-side user queries prior to OTP requests.
 * 3. Handles all Firebase Auth error codes explicitly.
 * 4. Disables app verification ONLY in local emulator mode; never in staging/production.
 * 5. Provides debounce/guard against simultaneous OTP requests.
 */

import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import { getActiveEnvironmentConfig } from '../config/environment';

export interface PhoneAuthResult {
  readonly success: boolean;
  readonly confirmation?: FirebaseAuthTypes.ConfirmationResult;
  readonly error?: string;
  readonly errorCode?: string;
}

export interface VerificationResult {
  readonly success: boolean;
  readonly user?: FirebaseAuthTypes.User;
  readonly error?: string;
  readonly errorCode?: string;
}

let isOtpRequestInProgress = false;

/**
 * Normalizes an Indian phone number string to canonical E.164 format (+91XXXXXXXXXX).
 * Rejects numbers that do not match exactly 10 digits after stripping non-numeric characters.
 */
export function normalizePhoneNumber(rawPhone: string): string {
  if (!rawPhone) {
    throw new Error('Phone number is required.');
  }

  // Strip all non-numeric characters
  const digitsOnly = rawPhone.replace(/\D/g, '');

  // If passed with 91 prefix and 12 total digits
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    const coreNumber = digitsOnly.substring(2);
    if (/^[6-9]\d{9}$/.test(coreNumber)) {
      return `+91${coreNumber}`;
    }
  }

  // Standard 10-digit Indian mobile format (starting with 6, 7, 8, or 9)
  if (digitsOnly.length === 10) {
    if (/^[6-9]\d{9}$/.test(digitsOnly)) {
      return `+91${digitsOnly}`;
    }
    throw new Error('Please enter a valid 10-digit Indian mobile number.');
  }

  throw new Error('Mobile number must be exactly 10 digits.');
}

/**
 * Requests an SMS OTP from Firebase Authentication for the given phone number.
 */
export async function requestPhoneOtp(rawPhone: string): Promise<PhoneAuthResult> {
  if (isOtpRequestInProgress) {
    return {
      success: false,
      error: 'An OTP request is already in progress. Please wait a moment.',
    };
  }

  let canonicalPhone: string;
  try {
    canonicalPhone = normalizePhoneNumber(rawPhone);
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Invalid phone number.',
    };
  }

  isOtpRequestInProgress = true;

  try {
    const config = getActiveEnvironmentConfig();

    // App verification is disabled ONLY in local emulator development.
    // In staging and production, safety requires live reCAPTCHA / SafetyNet verification.
    if (config.environment === 'local') {
      auth().settings.appVerificationDisabledForTesting = true;
    } else {
      auth().settings.appVerificationDisabledForTesting = false;
    }

    const confirmation = await auth().signInWithPhoneNumber(canonicalPhone);
    return {
      success: true,
      confirmation,
    };
  } catch (err: any) {
    console.error('[AuthService] Error requesting Phone OTP:', err);
    let userMessage = 'Failed to send OTP. Please check your network and try again.';

    if (err.code === 'auth/too-many-requests') {
      userMessage = 'Too many requests. Please wait a few minutes before trying again.';
    } else if (err.code === 'auth/invalid-phone-number') {
      userMessage = 'The phone number format is invalid.';
    } else if (err.code === 'auth/quota-exceeded') {
      userMessage = 'SMS quota exceeded for today. Please contact support or try later.';
    } else if (err.code === 'auth/network-request-failed') {
      userMessage = 'Network error. Please check your internet connection.';
    }

    return {
      success: false,
      error: userMessage,
      errorCode: err.code,
    };
  } finally {
    isOtpRequestInProgress = false;
  }
}

/**
 * Confirms the SMS OTP with Firebase Authentication.
 */
export async function confirmPhoneOtp(
  confirmation: FirebaseAuthTypes.ConfirmationResult,
  otpCode: string,
): Promise<VerificationResult> {
  const cleanCode = (otpCode || '').trim();

  if (!cleanCode || cleanCode.length !== 6 || !/^\d{6}$/.test(cleanCode)) {
    return {
      success: false,
      error: 'Please enter a valid 6-digit OTP.',
    };
  }

  try {
    const userCredential = await confirmation.confirm(cleanCode);
    return {
      success: true,
      user: userCredential?.user || auth().currentUser || undefined,
    };
  } catch (err: any) {
    console.error('[AuthService] Error confirming OTP:', err);
    let userMessage = 'Incorrect OTP. Please check and re-enter.';

    if (err.code === 'auth/invalid-verification-code') {
      userMessage = 'The OTP code is incorrect. Please try again.';
    } else if (err.code === 'auth/code-expired' || err.code === 'auth/session-expired') {
      userMessage = 'This OTP has expired. Please request a new OTP.';
    } else if (err.code === 'auth/user-disabled') {
      userMessage = 'This account has been disabled. Please contact the administrator.';
    } else if (err.code === 'auth/network-request-failed') {
      userMessage = 'Network error during verification. Please check your connection.';
    }

    return {
      success: false,
      error: userMessage,
      errorCode: err.code,
    };
  }
}

/**
 * Signs out the current user completely from Firebase Authentication.
 */
export async function signOutUser(): Promise<void> {
  try {
    await auth().signOut();
  } catch (error) {
    console.error('[AuthService] Error during sign-out:', error);
    throw error;
  }
}

/**
 * Gets the current authenticated user object.
 */
export function getCurrentUser(): FirebaseAuthTypes.User | null {
  return auth().currentUser;
}
