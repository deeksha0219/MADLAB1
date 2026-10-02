/**
 * GrabNGo - Pickup-Slot Capacity Sharding (Phase 4B)
 *
 * Implements Strategy A: Partitioned per-shard capacity.
 * Authority: Shard counts are authoritative in sharded mode.
 * Selection: Randomized starting index with sequential fallback.
 * Release: Exact shard release on cancellation/rejection.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

export const DEFAULT_SHARD_COUNT = 5;
export const MIN_SHARD_COUNT = 1;
export const MAX_SHARD_COUNT = 20;

function serverTimestamp() {
  if (admin.firestore?.FieldValue?.serverTimestamp) {
    return admin.firestore.FieldValue.serverTimestamp();
  }
  try {
    const { FieldValue } = require('@google-cloud/firestore');
    return FieldValue.serverTimestamp();
  } catch {
    return (admin.firestore as any).FieldValue.serverTimestamp();
  }
}

export interface PickupSlotCapacityShard {
  shardId: string;
  slotId: string;
  canteenId: string;
  allocatedCapacity: number;
  reservedCount: number;
  createdAt?: admin.firestore.FieldValue | admin.firestore.Timestamp;
  updatedAt: admin.firestore.FieldValue | admin.firestore.Timestamp;
}

export interface SlotReservationPlan {
  isSharded: boolean;
  shardId?: string;
  shardRef?: admin.firestore.DocumentReference;
  slotRef?: admin.firestore.DocumentReference;
  newReservedCount: number;
}

export interface SlotReleasePlan {
  isSharded: boolean;
  shardId?: string;
  shardRef?: admin.firestore.DocumentReference;
  slotRef?: admin.firestore.DocumentReference;
  newReservedCount: number;
}

/**
 * Deterministically partition capacity C across N shards such that
 * sum(shardCapacity[i]) === C.
 *
 * base = floor(C / N)
 * remainder = C % N
 * shardCapacity[i] = base + (i < remainder ? 1 : 0)
 */
export function computeShardCapacities(capacity: number, shardCount: number): number[] {
  if (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity < 0) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'capacity must be a non-negative integer.',
    );
  }
  if (
    typeof shardCount !== 'number' ||
    !Number.isInteger(shardCount) ||
    shardCount < MIN_SHARD_COUNT ||
    shardCount > MAX_SHARD_COUNT
  ) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `shardCount must be an integer between ${MIN_SHARD_COUNT} and ${MAX_SHARD_COUNT}.`,
    );
  }

  const base = Math.floor(capacity / shardCount);
  const remainder = capacity % shardCount;
  const allocations: number[] = [];

  for (let i = 0; i < shardCount; i++) {
    allocations.push(base + (i < remainder ? 1 : 0));
  }

  return allocations;
}

/**
 * Validates and selects a capacity shard (or validates legacy slot capacity)
 * during the READ phase of the order transaction.
 *
 * All transaction reads MUST precede all transaction writes.
 */
export async function planSlotReservationTx(
  transaction: admin.firestore.Transaction,
  canteenId: string,
  slotId: string,
  slotData: admin.firestore.DocumentData,
  slotRef: admin.firestore.DocumentReference,
): Promise<SlotReservationPlan> {
  // If slot is NOT sharded, follow existing legacy capacity check
  if (slotData.isSharded !== true) {
    if (slotData.reservedCount >= slotData.capacity) {
      throw new functions.https.HttpsError(
        'resource-exhausted',
        `Pickup slot ${slotId} is full (Capacity: ${slotData.capacity}).`,
      );
    }
    return {
      isSharded: false,
      slotRef,
      newReservedCount: slotData.reservedCount + 1,
    };
  }

  // Sharded Slot Validation
  const rawShardCount = slotData.shardCount;
  const shardCount =
    typeof rawShardCount === 'number' && Number.isInteger(rawShardCount)
      ? rawShardCount
      : rawShardCount === undefined
        ? DEFAULT_SHARD_COUNT
        : null;

  if (
    shardCount === null ||
    shardCount < MIN_SHARD_COUNT ||
    shardCount > MAX_SHARD_COUNT
  ) {
    console.warn(
      `[SlotSharding] Invalid shardCount ${rawShardCount} on sharded slot ${slotId} (canteen: ${canteenId})`,
    );
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Pickup slot ${slotId} has invalid sharding configuration.`,
    );
  }

  // Randomized start index followed by sequential fallback through all shards
  const startIndex = Math.floor(Math.random() * shardCount);
  const shardsColRef = slotRef.collection('capacityShards');

  for (let step = 0; step < shardCount; step++) {
    const shardIdx = (startIndex + step) % shardCount;
    const shardId = `shard_${shardIdx}`;
    const shardRef = shardsColRef.doc(shardId);
    const shardSnap = await transaction.get(shardRef);

    if (!shardSnap.exists) {
      console.warn(
        `[SlotSharding] Missing capacity shard doc ${shardId} on slot ${slotId} (canteen: ${canteenId})`,
      );
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Pickup slot ${slotId} capacity shard ${shardId} is missing.`,
      );
    }

    const shardData = shardSnap.data();
    const allocatedCapacity = shardData?.allocatedCapacity;
    const reservedCount = shardData?.reservedCount;

    if (
      typeof allocatedCapacity !== 'number' ||
      !Number.isInteger(allocatedCapacity) ||
      allocatedCapacity < 0 ||
      typeof reservedCount !== 'number' ||
      !Number.isInteger(reservedCount) ||
      reservedCount < 0
    ) {
      console.warn(
        `[SlotSharding] Malformed shard data in ${shardId} on slot ${slotId}: allocated=${allocatedCapacity}, reserved=${reservedCount}`,
      );
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Pickup slot ${slotId} capacity shard ${shardId} has invalid configuration.`,
      );
    }

    if (reservedCount < allocatedCapacity) {
      // Found available shard with partitioned capacity
      return {
        isSharded: true,
        shardId,
        shardRef,
        newReservedCount: reservedCount + 1,
      };
    }
  }

  // All shards exhausted
  throw new functions.https.HttpsError(
    'resource-exhausted',
    `Pickup slot ${slotId} is full (Capacity: ${slotData.capacity}).`,
  );
}

/**
 * Executes the slot reservation update inside the transaction WRITE phase.
 * Never mutates parent reservedCount for sharded slots during order checkout.
 */
export function executeSlotReservationTx(
  transaction: admin.firestore.Transaction,
  plan: SlotReservationPlan,
): void {
  if (plan.isSharded && plan.shardRef) {
    transaction.update(plan.shardRef, {
      reservedCount: plan.newReservedCount,
      updatedAt: serverTimestamp(),
    });
  } else if (plan.slotRef) {
    transaction.update(plan.slotRef, {
      reservedCount: plan.newReservedCount,
      updatedAt: serverTimestamp(),
    });
  }
}

/**
 * Validates and plans capacity release for cancellation or rejection.
 * If order has a stored shardId, release that exact shard.
 * Otherwise, falls back to legacy parent-slot release.
 */
export async function planSlotReleaseTx(
  transaction: admin.firestore.Transaction,
  db: admin.firestore.Firestore,
  canteenId: string,
  slotId: string,
  orderShardId?: string,
  legacyReleaseValidator?: (
    canteenId: string,
    slotId: string,
    slotSnap: admin.firestore.DocumentSnapshot,
  ) => { newReservedCount: number },
): Promise<SlotReleasePlan> {
  const slotRef = db
    .collection('canteens')
    .doc(canteenId)
    .collection('pickupSlots')
    .doc(slotId);

  // Exact Shard Release Path
  if (orderShardId && typeof orderShardId === 'string' && orderShardId.trim().length > 0) {
    const shardRef = slotRef.collection('capacityShards').doc(orderShardId);
    const shardSnap = await transaction.get(shardRef);

    if (!shardSnap.exists) {
      console.warn(
        `[SlotSharding] Capacity release failed: shard doc ${orderShardId} not found (canteen: ${canteenId}, slot: ${slotId})`,
      );
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Pickup slot capacity state is inconsistent.',
      );
    }

    const shardData = shardSnap.data();
    const reservedCount = shardData?.reservedCount;
    const allocatedCapacity = shardData?.allocatedCapacity;

    if (
      typeof reservedCount !== 'number' ||
      !Number.isInteger(reservedCount) ||
      typeof allocatedCapacity !== 'number' ||
      !Number.isInteger(allocatedCapacity) ||
      allocatedCapacity < 0
    ) {
      console.warn(
        `[SlotSharding] Capacity release failed: malformed shard ${orderShardId} (reserved=${reservedCount}, capacity=${allocatedCapacity})`,
      );
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Pickup slot capacity state is inconsistent.',
      );
    }

    if (reservedCount < 1 || reservedCount > allocatedCapacity) {
      console.warn(
        `[SlotSharding] Capacity release invariant failed: reserved=${reservedCount}, allocated=${allocatedCapacity} on shard ${orderShardId}`,
      );
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Pickup slot capacity state is inconsistent.',
      );
    }

    return {
      isSharded: true,
      shardId: orderShardId,
      shardRef,
      newReservedCount: reservedCount - 1,
    };
  }

  // Legacy Parent-Slot Release Path
  const slotSnap = await transaction.get(slotRef);
  if (!legacyReleaseValidator) {
    throw new functions.https.HttpsError(
      'internal',
      'Missing legacy capacity release validator.',
    );
  }
  const legacyResult = legacyReleaseValidator(canteenId, slotId, slotSnap);

  return {
    isSharded: false,
    slotRef,
    newReservedCount: legacyResult.newReservedCount,
  };
}

/**
 * Executes the slot release update inside the transaction WRITE phase.
 */
export function executeSlotReleaseTx(
  transaction: admin.firestore.Transaction,
  plan: SlotReleasePlan,
): void {
  if (plan.isSharded && plan.shardRef) {
    transaction.update(plan.shardRef, {
      reservedCount: plan.newReservedCount,
      updatedAt: serverTimestamp(),
    });
  } else if (plan.slotRef) {
    transaction.update(plan.slotRef, {
      reservedCount: plan.newReservedCount,
      updatedAt: serverTimestamp(),
    });
  }
}
