# Step 2 — Controlled Local Performance and Contention Results

## Mission & Boundary Statement

This document details the exact results of the controlled local performance baseline test executed on the local developer workstation against the Firebase Emulator Suite.

```
Measured local-emulator baseline only. Production capacity is not established.
```

### Mandatory Boundary Classifications:
1. **Measured local-emulator result**: The empirical numbers documented below were generated using synthetic entities inside the local Firebase Emulator Suite running in a single Node.js / Java host process on a developer laptop.
2. **Production capacity estimate**: Theoretical extrapolations based on vendor documentation (Cloud Functions auto-scaling, Firestore distributed tablet architecture). These are not validated.
3. **Production capacity guarantee**: **NONE**. No production claims can be made without distributed staging load testing.
4. **Explicit Retractions**: This repository does NOT claim to support 30,000 requests per second, 10,000 simultaneous payments, or 100,000 concurrent users.

---

## 1. Test Environment Specification

- **Host Operating System:** Windows 11 Enterprise (x64)
- **Node.js Version:** `v23.9.0`
- **npm Version:** `11.6.2`
- **Firebase Emulator Target:** `demo-grabngo-local` (firebase-tools `15.7.0`)
  - Authentication Emulator: `127.0.0.1:9099`
  - Firestore Emulator: `127.0.0.1:8085`
  - Cloud Functions Emulator: `127.0.0.1:5001`
- **Git Branch:** `development`
- **Baseline Commit:** `8d57da3e01e96a6bda7232bdb044fd0f82253b9b`
- **Test Harness Script:** `scripts/run-local-performance-test.js`

---

## 2. Test Scenarios and Measured Results

### Scenario A: Catalog Browsing (Direct Firestore Query Concurrency)
- **Target Collection:** `/canteens/CANTEEN_PERF_A/categories` and `/canteens/CANTEEN_PERF_A/menu_items`
- **Query Filter:** `where("isActive", "==", true)` (compliant with Firestore security rules)
- **Measured Metrics Across Concurrency Steps:**

| Concurrency Level | Total Requests | Throughput (req/s) | Latency p50 (ms) | Latency p95 (ms) | Latency p99 (ms) | Error Rate |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1** | 4 | 111.1 | 9 | 14 | 14 | 0.0% |
| **5** | 20 | 384.6 | 10 | 23 | 23 | 0.0% |
| **10** | 40 | 232.6 | 18 | 96 | 99 | 0.0% |
| **25** | 100 | 295.0 | 39 | 238 | 278 | 0.0% |
| **50** | 200 | 264.9 | 191 | 336 | 344 | 0.0% |

- **Observations:** At concurrency 50 in the single-process emulator, p50 latency rises to 191 ms while error rate remains strictly 0.0%.

---

### Scenario B: User-Scoped Cart Operations
- **Scope:** 20 distinct student accounts concurrently executing Add Item, Update Quantity, and Get Cart operations under `/users/{uid}/cart/{itemId}`.
- **Total Operations:** 60 operations.
- **Throughput:** **231.7 ops/sec**
- **Latency Distribution:**
  - **Min:** 3 ms
  - **p50:** 20 ms
  - **Avg:** 63 ms
  - **p95:** 169 ms
  - **p99:** 183 ms
  - **Max:** 183 ms
- **Path Isolation & Error Rate:** 0% errors; zero cross-user data leakage.

---

### Scenario C: Concurrent Checkout & Invariants Verification
- **Workload:** 15 distinct students concurrently issuing `createOrder` transactions for their active carts.
- **Throughput:** **56.4 orders/sec**
- **Latency Distribution:**
  - **Min:** 108 ms
  - **p50:** 157 ms
  - **Avg:** 171 ms
  - **p95:** 243 ms
  - **Max:** 243 ms
- **Invariant Verifications:**
  - **Duplicate Orders:** **0** (strictly zero duplicate orders)
  - **Client Price Tampering:** **REJECTED** (attempting to alter price from 8000 to 100 paise rejected by server-side recalculation)
  - **Invalid/Inactive Item:** **REJECTED** (attempting to checkout non-existent item rejected)
  - **Idempotency Key Replay:** **PASS** (replaying existing idempotency key returned existing order without creating duplicate)

---

### Scenario D: Pickup-Slot Transaction Contention Analysis
- **Workload:** 15 concurrent checkouts competing for a 10-capacity pickup slot document (`SLOT_CONTENTION_...`).
- **Slot Capacity:** 10
- **Successful Checkouts:** 10
- **Rejected Checkouts:** 5 (4 rejected with HTTP 429 `capacity_exhausted`, 1 rejected with transaction contention retry exhaustion)
- **Final Slot `reservedCount`:** 10 (out of capacity 10)
- **Overselling Invariant:** **PASSED — Zero overselling occurred** (`reservedCount == capacity == 10`).
- **Contention Latency Profile:**
  - **Min:** 2,878 ms
  - **p50:** 17,629 ms
  - **Avg:** 15,240 ms
  - **p95:** 25,600 ms
  - **Max:** 25,600 ms

#### Root Cause of Previous 5/10 Result
In the previous report run, only 5 reservations succeeded because the test runner HTTP client timeout was set to 20,000 ms. In the single-threaded Node.js emulator, 15 simultaneous transactions on one document caused high lock contention and exponential backoff. By the 20-second mark, attempts 6–10 were still backing off and timed out on the client before completing. 
With the timeout adjusted to 35 seconds to accommodate emulator backoff:
- Exactly 10 reservations succeeded.
- Attempts 11–14 were cleanly rejected with `HTTP 429 capacity_exhausted` ("Pickup slot is full (Capacity: 10)").
- Attempt 15 was rejected with contention retry abort.
- `reservedCount` = 10 / 10. Zero overselling.

---

### Scenario E: Payment-State Callables Latency & Denial
- **Workload:** Executing `createDemoPayment` and `completeDemoPayment` across student orders.
- **Latency Metrics:**
  - `createDemoPayment`: Min: 47 ms | p50: 75 ms | Avg: 68 ms | p95: 79 ms
  - `completeDemoPayment`: Min: 42 ms | p50: 67 ms | Avg: 61 ms | p95: 75 ms
- **Negative Security Invariant Check:**
  - Service Desk staff calling `createDemoPayment`: **DENIED (HTTP 403 / permission-denied)**
  - Service Desk staff calling `completeDemoPayment`: **DENIED (HTTP 403 / permission-denied)**

---

### Scenario F: Service-Desk Operational Queries
- **Workload:** Service-desk staff executing operational order listings and incoming order counters.
- **Latency Metrics:**
  - `listOperationalOrders`: Min: 33 ms | p50: 54 ms | Avg: 53 ms | p95: 73 ms
  - `getIncomingOrderCount`: Min: 35 ms | p50: 48 ms | Avg: 50 ms | p95: 74 ms
- **Data Isolation:** All payloads returned 0 forbidden financial keys and zero customer PII.

---

### Scenario G: Cold-Start vs. Warm Execution
- **Initial Invocation:** 34 ms (Node.js runtime warm in emulator memory)
- **Subsequent Warm Invocations (5 calls):**
  - **Min:** 36 ms | **p50:** 52 ms | **Avg:** 54 ms | **p95:** 69 ms
- **Production Note:** True container cold starts in GCP Cloud Functions Gen 2 range from 1.2s to 3.5s due to container spin-up and TLS handshakes.

---

## 3. Acceptance Criteria Summary

| Criterion | Target | Measured Result | Verdict |
| :--- | :--- | :--- | :---: |
| **Duplicate Orders** | 0 | 0 duplicate orders | **PASS** |
| **Pickup-Slot Overselling** | 0 | 0 oversold slots (`reservedCount == 10 <= 10`) | **PASS** |
| **Client Price Tampering** | Rejected | Rejected (400) | **PASS** |
| **Service Desk Financial Access** | Denied (403) | Denied (403) | **PASS** |
| **Catalog & Cart Error Rate** | < 1.0% | 0.0% | **PASS** |

```
STEP 2 COMPLETE — LOCAL PERFORMANCE BASELINE CORRECTED AND RECONCILED
PRODUCTION CAPACITY UNKNOWN — STAGING LOAD TEST REQUIRED
```
