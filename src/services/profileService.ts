/**
 * GrabNGo - Student Profile Service
 *
 * Security Rules:
 * 1. Profile document is keyed strictly by Firebase UID: users/{uid}
 * 2. Role is validated from stored data; NEVER hardcoded.
 * 3. Phone number is derived from verified Firebase Auth; mismatched submitted values are rejected.
 * 4. Passwords must NEVER be written to Firestore.
 * 5. @rvu.edu.in suffix checking verifies institutional formatting, but DOES NOT prove email ownership
 *    without email verification link confirmation or institutional SSO.
 */

import firestore from '@react-native-firebase/firestore';
import auth from '@react-native-firebase/auth';
import functions from '@react-native-firebase/functions';
import { normalizePhoneNumber } from './authService';

export interface StudentProfile {
  readonly uid: string;
  readonly name: string;
  readonly phone: string;
  readonly collegeId: string;
  readonly role: 'student';
  readonly status: 'active' | 'suspended';
  readonly createdAt?: any;
  readonly updatedAt?: any;
}

export interface ProfileUpdateInput {
  readonly name?: string;
  readonly collegeId?: string;
}

/**
 * Validates whether an email string matches the approved RVU domain format.
 *
 * IMPORTANT SECURITY NOTE:
 * Suffix checking validates formatting only. It DOES NOT prove ownership
 * of the specific email address without sending a verification link or using RVU Google Workspace SSO.
 */
export function isValidRvuEmail(email: string): boolean {
  if (!email) return false;
  const clean = email.trim().toLowerCase();
  return clean.endsWith('@rvu.edu.in') && clean.length > '@rvu.edu.in'.length;
}

/**
 * Retrieves the student profile from Firestore for the given user UID.
 * Validates the stored role and status dynamically; does NOT hardcode 'student'.
 */
export async function getStudentProfile(uid: string): Promise<StudentProfile | null> {
  if (!uid) {
    return null;
  }

  try {
    const docSnap = await firestore().collection('users').doc(uid).get();
    if (!docSnap.exists) {
      return null;
    }

    const data = docSnap.data();
    if (!data) return null;

    // VALIDATE stored role dynamically. If role is not 'student', reject
    if (data.role !== 'student') {
      console.warn(`[ProfileService] Document ${uid} has non-student role: ${data.role}`);
      return null;
    }

    return {
      uid: docSnap.id,
      name: data.name || '',
      phone: data.phone || '',
      collegeId: data.collegeId || '',
      role: data.role, // Derived from stored profile, not hardcoded
      status: data.status === 'active' ? 'active' : 'suspended',
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  } catch (error) {
    console.error(`[ProfileService] Error fetching profile for ${uid}:`, error);
    throw error;
  }
}

/**
 * Creates a new student profile in Firestore.
 * 1. Derives verified phone directly from Firebase Auth.
 * 2. Rejects submitted phone values if they do not match the verified Auth phone.
 * 3. Assigns role='student' and status='active' under strict Firestore Security Rules.
 * 4. Zero passwords permitted.
 */
export async function createStudentProfile(
  uid: string,
  input: { name: string; collegeId: string; phone?: string },
): Promise<StudentProfile> {
  const currentUser = auth().currentUser;
  if (!currentUser || currentUser.uid !== uid) {
    throw new Error('[SECURITY ERROR] Cannot create profile for another user.');
  }

  const verifiedPhone = currentUser.phoneNumber;
  if (!verifiedPhone) {
    throw new Error('[SECURITY ERROR] Verified phone number not found in Firebase Authentication.');
  }

  // If client passes a phone number, reject if it does not match the verified Auth phone
  if (input.phone) {
    const canonicalSubmitted = normalizePhoneNumber(input.phone);
    if (canonicalSubmitted !== verifiedPhone) {
      throw new Error(
        '[SECURITY ERROR] Submitted phone number does not match the verified authentication phone.',
      );
    }
  }

  const name = (input.name || '').trim();
  const collegeId = (input.collegeId || '').trim().toLowerCase();

  if (!name || name.length < 2) {
    throw new Error('Name must be at least 2 characters.');
  }

  if (!isValidRvuEmail(collegeId)) {
    throw new Error('Only @rvu.edu.in emails are allowed.');
  }

  try {
    // Invoke trusted serverless Cloud Function to create authoritative student profile
    const createProfileCallable = functions().httpsCallable('createStudentProfile');
    const response = await createProfileCallable({
      name,
      collegeId,
      phone: verifiedPhone,
    });

    const result = response.data as any;

    return {
      uid,
      name,
      phone: verifiedPhone,
      collegeId,
      role: 'student',
      status: 'active',
      createdAt: result?.profile?.createdAt,
      updatedAt: result?.profile?.updatedAt,
    };
  } catch (error: any) {
    console.error('[ProfileService] Error creating profile via Cloud Function:', error);
    throw error;
  }
}

/**
 * Updates editable profile fields for the currently authenticated user.
 * Restricted to name and collegeId, matching the Firestore Rules diff().affectedKeys() allowlist.
 */
export async function updateStudentProfile(
  uid: string,
  input: ProfileUpdateInput,
): Promise<void> {
  const currentUser = auth().currentUser;
  if (!currentUser || currentUser.uid !== uid) {
    throw new Error('[SECURITY ERROR] Cannot update profile for another user.');
  }

  const updates: Record<string, any> = {
    updatedAt: firestore.FieldValue.serverTimestamp(),
  };

  if (input.name) {
    const cleanName = input.name.trim();
    if (cleanName.length < 2) {
      throw new Error('Name must be at least 2 characters.');
    }
    updates.name = cleanName;
  }

  if (input.collegeId) {
    const cleanEmail = input.collegeId.trim().toLowerCase();
    if (!isValidRvuEmail(cleanEmail)) {
      throw new Error('Only @rvu.edu.in emails are allowed.');
    }
    updates.collegeId = cleanEmail;
  }

  try {
    // Firestore rules enforce diff().affectedKeys().hasOnly(['name', 'collegeId', 'updatedAt'])
    await firestore().collection('users').doc(uid).update(updates);
  } catch (error) {
    console.error('[ProfileService] Error updating profile:', error);
    throw error;
  }
}
