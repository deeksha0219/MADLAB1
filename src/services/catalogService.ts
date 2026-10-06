/**
 * GrabNGo - Menu, Canteen, and Catalog Service (Step 6)
 *
 * Security & Architectural Constraints:
 * 1. Money is ALWAYS handled as integer minor units (paise). Never floats.
 * 2. Students can read active canteens, active categories, and active+available items.
 * 3. All catalog mutations MUST pass through trusted callable Cloud Functions.
 * 4. Client writes are completely denied at the Firestore Security Rules level.
 */

import firestore from '@react-native-firebase/firestore';
import functions from '@react-native-firebase/functions';

export interface Canteen {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly isActive: boolean;
  readonly createdAt?: any;
  readonly updatedAt?: any;
}

export interface MenuCategory {
  readonly id: string;
  readonly canteenId: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly createdAt?: any;
  readonly updatedAt?: any;
}

export interface MenuItem {
  readonly id: string;
  readonly canteenId: string;
  readonly name: string;
  readonly description?: string;
  readonly categoryId: string;
  readonly priceInPaise: number;
  readonly imageUrl?: string;
  readonly isAvailable: boolean;
  readonly isActive: boolean;
  readonly sortOrder: number;
  readonly createdAt?: any;
  readonly updatedAt?: any;
}

/**
 * Formats an integer minor unit (paise) into a human-readable INR string.
 * Example: 5000 -> "₹50.00", 12550 -> "₹125.50", 0 -> "₹0.00"
 */
export function formatPaiseToRupees(paise: number): string {
  if (typeof paise !== 'number' || !Number.isFinite(paise) || paise < 0) {
    return '₹0.00';
  }
  const integerPaise = Math.floor(paise);
  const rupees = Math.floor(integerPaise / 100);
  const remainder = integerPaise % 100;
  const remainderStr = remainder.toString().padStart(2, '0');
  return `₹${rupees}.${remainderStr}`;
}

/**
 * Fetches all active canteens for student browsing.
 */
export async function getActiveCanteens(): Promise<Canteen[]> {
  try {
    const snapshot = await firestore()
      .collection('canteens')
      .where('isActive', '==', true)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name || '',
        code: data.code || '',
        isActive: data.isActive === true,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
    });
  } catch (err) {
    console.error('[catalogService] getActiveCanteens error:', err);
    throw err;
  }
}

/**
 * Fetches all active categories for a specified canteen.
 */
export async function getCategoriesForCanteen(canteenId: string): Promise<MenuCategory[]> {
  if (!canteenId) return [];

  try {
    const snapshot = await firestore()
      .collection('canteens')
      .doc(canteenId)
      .collection('categories')
      .where('isActive', '==', true)
      .orderBy('sortOrder', 'asc')
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        canteenId,
        name: data.name || '',
        sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
        isActive: data.isActive === true,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
    });
  } catch (err) {
    console.error('[catalogService] getCategoriesForCanteen error:', err);
    throw err;
  }
}

/**
 * Fetches available and active menu items for a category within a canteen.
 */
export async function getAvailableItemsForCategory(
  canteenId: string,
  categoryId: string
): Promise<MenuItem[]> {
  if (!canteenId || !categoryId) return [];

  try {
    const snapshot = await firestore()
      .collection('canteens')
      .doc(canteenId)
      .collection('items')
      .where('categoryId', '==', categoryId)
      .where('isActive', '==', true)
      .where('isAvailable', '==', true)
      .orderBy('sortOrder', 'asc')
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        canteenId,
        name: data.name || '',
        description: data.description || '',
        categoryId: data.categoryId || categoryId,
        priceInPaise: typeof data.priceInPaise === 'number' ? data.priceInPaise : 0,
        imageUrl: data.imageUrl || undefined,
        isAvailable: data.isAvailable === true,
        isActive: data.isActive === true,
        sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
    });
  } catch (err) {
    console.error('[catalogService] getAvailableItemsForCategory error:', err);
    throw err;
  }
}

/**
 * Fetches all available and active menu items for an entire canteen.
 */
export async function getAvailableItemsForCanteen(canteenId: string): Promise<MenuItem[]> {
  if (!canteenId) return [];

  try {
    const snapshot = await firestore()
      .collection('canteens')
      .doc(canteenId)
      .collection('items')
      .where('isActive', '==', true)
      .where('isAvailable', '==', true)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        canteenId,
        name: data.name || '',
        description: data.description || '',
        categoryId: data.categoryId || '',
        priceInPaise: typeof data.priceInPaise === 'number' ? data.priceInPaise : 0,
        imageUrl: data.imageUrl || undefined,
        isAvailable: data.isAvailable === true,
        isActive: data.isActive === true,
        sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
    });
  } catch (err) {
    console.error('[catalogService] getAvailableItemsForCanteen error:', err);
    throw err;
  }
}

// ----------------------------------------------------------------------------
// Admin Mutating Operations (Dispatched exclusively via Cloud Functions)
// ----------------------------------------------------------------------------

export async function createCanteen(data: { name: string; code: string }) {
  const fn = functions().httpsCallable('createCanteen');
  const result = await fn(data);
  return result.data;
}

export async function updateCanteen(data: { canteenId: string; name?: string }) {
  const fn = functions().httpsCallable('updateCanteen');
  const result = await fn(data);
  return result.data;
}

export async function setCanteenActive(data: { canteenId: string; isActive: boolean }) {
  const fn = functions().httpsCallable('setCanteenActive');
  const result = await fn(data);
  return result.data;
}

export async function createCategory(data: { canteenId: string; name: string; sortOrder?: number }) {
  const fn = functions().httpsCallable('createCategory');
  const result = await fn(data);
  return result.data;
}

export async function updateCategory(data: {
  canteenId: string;
  categoryId: string;
  name?: string;
  sortOrder?: number;
}) {
  const fn = functions().httpsCallable('updateCategory');
  const result = await fn(data);
  return result.data;
}

export async function setCategoryActive(data: {
  canteenId: string;
  categoryId: string;
  isActive: boolean;
}) {
  const fn = functions().httpsCallable('setCategoryActive');
  const result = await fn(data);
  return result.data;
}

export async function createMenuItem(data: {
  canteenId: string;
  name: string;
  categoryId: string;
  priceInPaise: number;
  description?: string;
  imageUrl?: string;
  isAvailable?: boolean;
  sortOrder?: number;
}) {
  const fn = functions().httpsCallable('createMenuItem');
  const result = await fn(data);
  return result.data;
}

export async function updateMenuItem(data: {
  canteenId: string;
  itemId: string;
  name?: string;
  description?: string;
  priceInPaise?: number;
  imageUrl?: string;
  sortOrder?: number;
}) {
  const fn = functions().httpsCallable('updateMenuItem');
  const result = await fn(data);
  return result.data;
}

export async function setMenuItemAvailability(data: {
  canteenId: string;
  itemId: string;
  isAvailable: boolean;
}) {
  const fn = functions().httpsCallable('setMenuItemAvailability');
  const result = await fn(data);
  return result.data;
}

export async function setMenuItemActive(data: {
  canteenId: string;
  itemId: string;
  isActive: boolean;
}) {
  const fn = functions().httpsCallable('setMenuItemActive');
  const result = await fn(data);
  return result.data;
}
