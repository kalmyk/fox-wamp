## Context

The current distributed ID generation system uses two synchronization stages to achieve consensus on permanent IDs:

1. **StageOne** — Collect draft IDs from all sync nodes, select minimum.
2. **StageTwo** — Collect minimum values from all StageOne nodes, select maximum.

Both stages accumulate voting data indefinitely in persistent in-memory heaps (`draftHeap`, `readyQuorum`), causing unbounded memory growth. Additionally, there is no timeout mechanism for segments that fail to reach quorum.

The system should generate consensus IDs using stateless real-time sorting and validation. Each stage should accept votes, validate quorum, produce a result, and immediately discard temporary state.

## Goals / Non-Goals

**Goals:**
- Eliminate persistent heap structures in StageOne and StageTwoTask.
- Implement stateless voting: track current minimum/maximum across voters without accumulating history.
- Add timeout/expiry mechanisms for segments that don't reach quorum.
- Implement collision prevention: once an advanceId is resolved, cache the result to avoid resending duplicate IDs.
- Maintain monotonic ID ordering (no out-of-order IDs).
- Ensure no duplicate IDs are ever issued for the same advance segment.

**Non-Goals:**
- Changing the overall architecture (still two-stage voting).
- Changing ID format or structure.
- Implementing automatic ID cleanup.
- Live migration of old system to new system.

## Decisions

### 1. Stateless Voting in StageOne

**Current Problem:**
```typescript
private draftHeap: Map<string, string[]> = new Map() // draftOwner -> array of draftIds
// Accumulates indefinitely; entries only pruned when extracted
```

**New Approach:**

For each `advanceId` (`advanceOwner:advanceSegment`), maintain only:
- The **minimum draft ID** seen so far (current best)
- The **set of voters who have voted** (to count quorum)
- The **timestamp** when the entry was created (for timeout)

```typescript
type StageOneVotingEntry = {
  advanceId: string,          // "entryId:segmentNumber"
  minDraftId: string,         // minimum draft seen
  voters: Set<string>,        // nodeIds that have voted
  createdAt: number,          // timestamp for timeout
  result?: string             // final result after quorum
}
```

**Process:**

1. When `PICK_CHALLENGER` arrives for `advanceId` with `draftId`:
   - Get or create voting entry for `advanceId`.
   - Update `minDraftId` if `draftId < minDraftId`.
   - Add sender to `voters` set.
   - Check if `voters.size >= syncQuorum`.

2. If quorum reached:
   - Store result in `result` field.
   - Publish `ELECT_SEGMENT` with `minDraftId`.
   - Keep entry for 5 minutes for deduplication.
   - Then discard.

3. If timeout (30s) without quorum:
   - Log warning.
   - Discard entry.
   - On retry, create new entry.

**Memory Benefit:**
- Old: Accumulates all draft IDs per owner (unbounded).
- New: One entry per `advanceId` for 5 minutes after completion, then discarded.
- Bound: Max entries = (entry timeout × message rate) — typically 100-1000, not millions.

### 2. Stateless Voting in StageTwoTask

**Current Problem:**
```typescript
private readyQuorum: Map<string, ReadyVouterChallenger> = new Map()
// Accumulates indefinitely; entries only deleted when quorum reached
// No timeout for stuck segments
```

**New Approach:**

For each `advanceId`, maintain only:
- The **maximum challenger** seen so far (current best).
- The **set of voters who have voted** (to count quorum).
- The **timestamp** when the entry was created (for timeout).

```typescript
type StageTwoVotingEntry = {
  advanceId: string,          // "entryId:segmentNumber"
  maxChallenger: string,      // maximum challenger seen
  voters: Set<string>,        // nodeIds that have voted
  createdAt: number,          // timestamp for timeout
  result?: string             // final result after quorum
}
```

**Process:**

1. When `ELECT_SEGMENT` arrives for `advanceId` with `challenger`:
   - Get or create voting entry for `advanceId`.
   - Update `maxChallenger` if `challenger > maxChallenger`.
   - Add sender to `voters` set.
   - Check if `voters.size >= syncQuorum`.

2. If quorum reached:
   - Store result in `result` field.
   - Publish `ADVANCE_SEGMENT_RESOLVED` with `maxChallenger`.
   - Keep entry for 5 minutes for deduplication.
   - Then discard.

3. If timeout (30s) without quorum:
   - Log error.
   - Publish error back to entry node.
   - Discard entry.
   - Entry node retries with new advance segment.

**Memory Benefit:**
- Old: Accumulates all voters/challengers per `advanceId`, persists indefinitely.
- New: One entry per `advanceId` for 5 minutes after completion, then discarded.
- Bound: Same as StageOne — 100-1000 entries at peak.

### 3. Collision Prevention with Result Cache

**Requirement:** Prevent re-sending collision IDs (same advanceId should always resolve to same final ID).

**Solution:**

Maintain a bounded time-windowed cache of resolved advanceIds:

```typescript
type ResolutionCache = {
  advanceId: string,
  finalId: string,
  resolvedAt: number,
  ttl: number  // e.g., 5 minutes = 300000ms
}

private resolutionCache: Map<string, ResolutionCache> = new Map()
```

**Process:**

1. Before creating a new voting entry, check cache:
   ```
   if (resolutionCache.has(advanceId)):
     return cachedResult
   ```

2. After quorum and result:
   ```
   resolutionCache.set(advanceId, { finalId, resolvedAt: now(), ttl: 300000 })
   ```

3. Periodically (e.g., every 10s), purge expired entries:
   ```
   for each (advanceId, entry) in cache:
     if (now() - entry.resolvedAt > entry.ttl):
       cache.delete(advanceId)
   ```

**Memory Bound:**
- Max cache size = (cache TTL in ms) × (messages per second) / 1000
- Example: 5 min × 100 msg/s / 1000 = 30,000 entries (bounded).

### 4. Timeout Enforcement

**Rationale:** Segments waiting for quorum must have a timeout to prevent indefinite accumulation.

**Implementation:**

1. Record `createdAt` timestamp when voting entry is created.
2. In event handler, check:
   ```
   if (now() - entry.createdAt > TIMEOUT_MS):
     discard entry
     log error
     publish error back to entry node (if StageTwo)
   ```

3. Recommended timeouts:
   - **StageOne**: 30 seconds (time to collect votes from all sync nodes).
   - **StageTwoTask**: 30 seconds (time to collect results from all StageOne nodes).
   - **Backoff on retry**: Entry node waits before retrying with new advance segment.

### 5. Data Structures Summary

**StageOne:**
```typescript
private votingEntries: Map<string, StageOneVotingEntry> = new Map()
private resolutionCache: Map<string, ResolutionCache> = new Map()
```

**StageTwoTask:**
```typescript
private votingEntries: Map<string, StageTwoVotingEntry> = new Map()
private resolutionCache: Map<string, ResolutionCache> = new Map()
```

Both stages maintain:
- One entry per `advanceId` during voting.
- Cached result for 5 minutes after completion.
- Automatic cleanup on timeout or cache expiry.

### 6. Monotonic Ordering

**Constraint:** Final IDs must be monotonically increasing within a cluster (no out-of-order assignments).

**Existing Mechanism:**
- `ProduceId.reconcilePos(prefix, offset)` already tracks the highest seen position.
- This prevents regressions.

**No Change Needed:** The stateless voting approach doesn't affect monotonicity. The max/min selection logic remains the same.

## Risks / Trade-offs

- **Timeout False Positives** — If network is slow or segment takes >30s to reach quorum, timeout fires and entry must retry. Mitigation: Make timeout configurable, monitor network latency.
- **Cache Size Estimation** — Predicting peak cache size depends on message rate. Mitigation: Monitor cache size in production, adjust TTL if needed.
- **Lost Segments** — If all copies of an advance segment are lost before resolution, cluster can't recover. Mitigation: Entry nodes should persist advance segments to durable storage before distributing.
- **Duplicate Votes** — If a node votes twice for the same advanceId, voting entry may double-count. Mitigation: Use voter set to deduplicate (already in design).

## Backward Compatibility

- **Not compatible** with old system running in parallel.
- **Recommendation:** Deploy to new cluster or perform coordinated cutover where all nodes are stopped and restarted with new code.
- **No data migration** — ID generation state is ephemeral, not persisted.
