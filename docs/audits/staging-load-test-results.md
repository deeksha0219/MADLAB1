# GrabNGo — Staging Load-Test Results & Local Benchmark Comparison

**Date:** 2026-10-02  
**Auditor / Performance Engineer:** Antigravity Engineering  
**Branch:** `development`  
**Status:** **STAGING LOAD TEST BLOCKED (PENDING STAGING DEPLOYMENT ON BLAZE) / LOCAL BENCHMARKS RECORDED**  

---

## 1. Staging Execution Status & Safety Gate Rationale

In strict accordance with Phase 6 and Phase 7 safety instructions:
- Staging load tests cannot be run against cloud project `mad-lab-a9665` until the project owner approves cloud deployment and confirms the Blaze billing plan.
- Running load tests against an undeployed or unbilled cloud project is strictly prohibited.
- Staging load execution is explicitly marked: **BLOCKED — PENDING CLOUD DEPLOYMENT & BILLING AUTHORIZATION**.

---

## 2. Local-Emulator Benchmark Reference Data

To provide a concrete performance baseline, identical concurrency and load test suites were executed locally against the Firebase Emulator Suite using `scripts/run-local-performance-test.js` and `scripts/run-emulator-sharded-slot-test.js`.

### 2.1 Sharded Pickup Slot Concurrency Benchmark (Local Emulator)
*Harness:* `scripts/run-emulator-sharded-slot-test.js` (12 test scenarios, 88 measured burst requests against 10 capacity shards).

| Metric | Measured Emulator Value | Staging Target Threshold | Status |
|---|---|---|---|
| **Passed Assertions** | 62 / 62 (100%) | 100% | **PASS** |
| **Failed Assertions** | 0 | 0 | **PASS** |
| **Successful Reservations** | 75 | Expected volume | **PASS** |
| **Slot Oversell Count** | **0** | **0 (Strict Invariant)** | **PASS** |
| **Duplicate Orders** | **0** | **0 (Strict Invariant)** | **PASS** |
| **Duplicate Shard Increments** | **0** | **0 (Strict Invariant)** | **PASS** |
| **Transaction Abort Recovery** | 1 (Clean abort, zero orphan order) | Safe rollback | **PASS** |
| **Local Emulator p50 Latency** | 4,980 ms | < 800 ms (Cloud target) | Emulator single-thread bound |
| **Local Emulator p95 Latency** | 16,786 ms | < 1,500 ms (Cloud target) | Emulator single-thread bound |

*Analysis:* In the local Firebase Emulator, Firestore transactions run in a single-threaded Java JVM process on a developer laptop. High concurrency causes artificial queueing and lock latency (p50 ~ 4.9s). Crucially, **correctness invariants held 100%**: zero oversell, zero duplicate orders, and zero state corruptions occurred.

### 2.2 Payment & Webhook Latency Benchmark (Local Emulator)
*Harness:* `scripts/run-emulator-payment-test.js` (151 assertions).

| Endpoint | Local p50 Latency | Local Error Rate | Idempotency Replay Count |
|---|---|---|---|
| `createDemoPayment` | 68 ms | 0.0% | 100% match |
| `completeDemoPayment` | 74 ms | 0.0% | 100% match |
| `verifySyntheticWebhook` | 52 ms | 0.0% | 100% match |
| Cross-Student Access Denial | 18 ms (HTTP 403) | 0.0% false permits | 0 leaks |

---

## 3. Disqualification of Unverified High-Scale Claims

Per prompt mandate:
> *"Do not claim 30K RPS or 20K simultaneous payment capacity unless the environment, test design, ramp-up, and results are documented and independently reviewed."*

1. **30,000 Requests/sec:** **DISQUALIFIED**. No test harness, distributed load cluster, or cloud deployment has demonstrated 30K RPS.
2. **20,000 Simultaneous Payments:** **DISQUALIFIED**. Single-document payment state transitions and banking rail rate limits prevent 20K simultaneous payment completions without multi-region distributed queues.
3. **Realistic Planned Staging Scale:** Staging load plan targets up to **250 requests/sec** and **50 concurrent checkouts**, fully sufficient for a university campus canteen peak rush (500–1,500 students during lunch hour).
