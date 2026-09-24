/**
 * GrabNGo - Admin Authorization Service
 *
 * Security Principles:
 * 1. Admin permissions are authoritative in Firestore 'admins/{uid}' and Custom Claims.
 * 2. The client is strictly read-only and CANNOT grant or modify its own admin role or canteen IDs.
 * 3. Client routing uses this service for navigation convenience, but actual authorization
 *    is enforced by Firestore Security Rules and Cloud Functions.
 */

import firestore from '@react-native-firebase/firestore';

export interface AdminProfile {
  readonly uid: string;
  readonly role: 'canteen_admin' | 'service_desk' | 'platform_operator';
  readonly canteenIds: string[];
  readonly status: 'active' | 'inactive';
  readonly createdAt?: any;
  readonly updatedAt?: any;
}

export interface AdminVerificationResult {
  readonly isAdmin: boolean;
  readonly adminProfile: AdminProfile | null;
  readonly canteenIds: string[];
}

/**
 * Fetches admin record for an authenticated user UID from 'admins/{uid}'.
 * Enforced by Firestore Security Rules: Non-admin users or users querying other UIDs
 * are rejected at the database level.
 */
export async function getAdminProfile(uid: string): Promise<AdminProfile | null> {
  if (!uid) {
    return null;
  }

  try {
    const docSnap = await firestore().collection('admins').doc(uid).get();

    if (!docSnap.exists) {
      return null;
    }

    const data = docSnap.data();
    const isAuthorizedRole =
      data &&
      data.status === 'active' &&
      (data.role === 'canteen_admin' || data.role === 'service_desk' || data.role === 'platform_operator');

    if (!isAuthorizedRole) {
      return null;
    }

    return {
      uid: docSnap.id,
      role: data.role,
      canteenIds: Array.isArray(data.canteenIds) ? data.canteenIds : [],
      status: 'active',
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  } catch {
    // If permission is denied by Firestore Rules, the user is not an authorized active admin
    return null;
  }
}
