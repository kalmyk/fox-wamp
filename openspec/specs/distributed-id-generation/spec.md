# Distributed ID Generation Specification

## Overview

This specification defines the stateless voting protocol and data structures for consensus-based ID generation across a distributed cluster. The system eliminates persistent accumulation heaps and enforces timeouts to prevent unbounded memory growth.

## Voting Data Structures

### StageOne Voting Entry

```typescript
type StageOneVotingEntry = {
  advanceId: string,              // "advanceOwner:advanceStamp"
  minDraftId: string,             // minimum draft ID seen from all voters
  voters: Set<string>,            // set of node IDs that voted
  createdAt: number,              // timestamp when entry created (ms since epoch)
  result?: string,                // final minimum ID after quorum (set on completion)
  draftsByVoter?: Map<string, string>  // optional: track latest draft per voter for debugging
}
```

### StageTwoTask Voting Entry

```typescript
type StageTwoVotingEntry = {
  advanceId: string,              // "advanceOwner:advanceStamp"
  maxChallenger: string,          // maximum challenger seen from all voters
  voters: Set<string>,            // set of node IDs that voted
  createdAt: number,              // timestamp when entry created (ms since epoch)
  result?: string,                // final maximum ID after quorum (set on completion)
}
```

### Resolution Cache Entry

```typescript
type ResolutionCache = {
  advanceId: string,
  finalId: string,
  resolvedAt: number,             // timestamp when resolved
  ttl: number,                    // time-to-live in milliseconds (default: 300000 = 5 min)
  stage: 'one' | 'two'           // which stage resolved this
}
```

## StageOne Protocol

### Input Event: PICK_CHALLENGER

**Source:** Peer StageOne nodes

**Payload:**
```json
{
  "advanceOwner": "entry1",
  "advanceStamp": 12345,
  "shardTag": "shard-0",
  "draftOwner": "sync-node-2",
  "draftId": {
    "dt": "260616",
    "id": 42
  }
}
```

### Processing Steps

1. **Extract advanceId:**
   ```
   advanceId = advanceOwner + ':' + advanceStamp
   ```

2. **Check resolution cache:**
   ```
   if resolutionCache.has(advanceId):
     if (now() - cache[advanceId].resolvedAt < cache[advanceId].ttl):
       publish ELECT_SEGMENT with cached result
       return
     else:
       cache.delete(advanceId)  // expired
   ```

3. **Get or create voting entry:**
   ```
   entry = votingEntries.get(advanceId)
   if not entry:
     entry = {
       advanceId,
       minDraftId: draftId,  // key: keyComplexId(draftId)
       voters: new Set([draftOwner]),
       createdAt: now()
     }
     votingEntries.set(advanceId, entry)
   else:
     // Update minimum
     if keyComplexId(draftId) < entry.minDraftId:
       entry.minDraftId = keyComplexId(draftId)
     
     // Add voter
     entry.voters.add(draftOwner)
   ```

4. **Check timeout:**
   ```
   if (now() - entry.createdAt > TIMEOUT_MS):  // e.g., 30000
     votingEntries.delete(advanceId)
     logWarning("StageOne: Timeout for " + advanceId + " after " + entry.voters.size + " votes")
     return  // discard entry
   ```

5. **Check quorum:**
   ```
   if entry.voters.size >= syncQuorum:
     entry.result = entry.minDraftId
     votingEntries.delete(advanceId)
     
     // Cache result
     resolutionCache.set(advanceId, {
       advanceId,
       finalId: entry.minDraftId,
       resolvedAt: now(),
       ttl: 300000,
       stage: 'one'
     })
     
     // Publish to StageTwo
     publish ELECT_SEGMENT with {
       advanceOwner,
       advanceStamp,
       shardTag,
       voter: myId,
       challenger: entry.minDraftId
     }
   ```

### Output Event: ELECT_SEGMENT

**Target:** StageTwoTask

**Payload:**
```json
{
  "advanceOwner": "entry1",
  "advanceStamp": 12345,
  "shardTag": "shard-0",
  "voter": "sync-node-1",
  "challenger": "260616~"  // the minimum draft ID
}
```

## StageTwoTask Protocol

### Input Event: ELECT_SEGMENT

**Source:** StageOne nodes

**Payload:** (same as output from StageOne)

### Processing Steps

1. **Extract advanceId:**
   ```
   advanceId = advanceOwner + ':' + advanceStamp
   ```

2. **Check resolution cache:**
   ```
   if resolutionCache.has(advanceId):
     if (now() - cache[advanceId].resolvedAt < cache[advanceId].ttl):
       publish ADVANCE_SEGMENT_RESOLVED with cached result
       return
     else:
       cache.delete(advanceId)  // expired
   ```

3. **Reject if already seen from StageOne:**
   ```
   if challenger < recentValue:  // recentValue = highest ID we've resolved
     logInfo("ELECT_SEGMENT skipped: " + challenger + " < " + recentValue)
     return
   ```

4. **Get or create voting entry:**
   ```
   entry = votingEntries.get(advanceId)
   if not entry:
     entry = {
       advanceId,
       maxChallenger: challenger,
       voters: new Set([voter]),
       createdAt: now()
     }
     votingEntries.set(advanceId, entry)
   else:
     // Update maximum
     if challenger > entry.maxChallenger:
       entry.maxChallenger = challenger
     
     // Add voter
     entry.voters.add(voter)
   ```

5. **Check timeout:**
   ```
   if (now() - entry.createdAt > TIMEOUT_MS):  // e.g., 30000
     votingEntries.delete(advanceId)
     logError("StageTwo: Timeout for " + advanceId + " after " + entry.voters.size + " votes")
     
     // Publish error back to entry node
     publish ADVANCE_SEGMENT_FAILED with {
       advanceOwner,
       advanceStamp,
       reason: "Timeout at StageTwo"
     }
     return  // discard entry
   ```

6. **Check quorum:**
   ```
   if entry.voters.size >= syncQuorum:
     entry.result = entry.maxChallenger
     votingEntries.delete(advanceId)
     
     // Cache result
     resolutionCache.set(advanceId, {
       advanceId,
       finalId: entry.maxChallenger,
       resolvedAt: now(),
       ttl: 300000,
       stage: 'two'
     })
     
     // Update recentValue (monotonic)
     setRecentValue(entry.maxChallenger)
     
     // Publish resolution back to entry node
     publish ADVANCE_SEGMENT_RESOLVED with {
       advanceOwner,
       advanceStamp,
       segment: entry.maxChallenger
     }
   ```

### Output Event: ADVANCE_SEGMENT_RESOLVED

**Target:** Broadcast on sys realm; entry nodes filter by `advanceOwner === this.router.getId()`

**Payload:**
```json
{
  "advanceOwner": "entry1",
  "advanceStamp": 12345,
  "segment": "260616~"  // the final ID to use
}
```

## Collision Prevention

### Requirement

Once an `advanceId` resolves to a `finalId`, that binding must be immutable. No retransmission of conflicting IDs.

### Mechanism

1. **Resolution Cache**: Store (advanceId → finalId) with 5-minute TTL.
2. **Early Return**: If the same `advanceId` arrives again before cache expires, return cached result immediately.
3. **Expiry**: After TTL, entry can be dropped; if advanceId arrives again, it's treated as new (new quorum).

### Guarantees

- **No Duplicate IDs**: Same advanceId always resolves to same finalId (within 5 minutes).
- **No Out-of-Order IDs**: `recentValue` tracking ensures monotonic progression.
- **Bounded Memory**: Cache size = (TTL × message_rate); with 300s TTL and 100 msg/s = ~30K entries.

## Timeout Configuration

| Component | Default | Rationale |
|-----------|---------|-----------|
| StageOne timeout | 30s | Time to collect votes from all sync nodes |
| StageTwoTask timeout | 30s | Time to collect results from all StageOne nodes |
| Resolution cache TTL | 300s (5 min) | Time to deduplicate retransmissions |
| Cleanup interval | 10s | Period to purge expired cache entries |

## Monotonic Ordering

### Guarantee

Final IDs must be monotonically non-decreasing within a cluster.

### Mechanism

- **StageOne** selects **minimum** draft (ensures determinism across nodes).
- **StageTwoTask** selects **maximum** minimum (ensures progress).
- **recentValue tracking** prevents rollback.

### Property

```
advanceId_1.finalId <= advanceId_2.finalId  (monotonic)
```

## Error Scenarios

### Scenario: Segment Timeout at StageOne

1. Entry sends PICK_CHALLENGER to all sync nodes.
2. One node dies before voting.
3. After 30s without quorum, entry discards voting.
4. Entry node is notified (or detects via timeout).
5. Entry node retries with new advance segment.

### Scenario: Segment Timeout at StageTwoTask

1. StageOne publishes ELECT_SEGMENT from 2 nodes.
2. Third node is offline.
3. After 30s without quorum (need 3), StageTwoTask publishes ADVANCE_SEGMENT_FAILED.
4. Entry node receives failure and retries.

### Scenario: Duplicate Vote

1. Node votes for advanceId.
2. Network delays; node retransmits vote.
3. Voting entry uses `Set<voters>` to deduplicate.
4. Duplicate is ignored; only counted once.

## Success Criteria

- StageOne: Minimum draft ID selected and published to StageTwo when quorum reached.
- StageTwoTask: Maximum challenger selected and published to entry when quorum reached.
- Collision Prevention: Same advanceId always resolves to same finalId.
- Timeout: Segments without quorum are discarded after 30s, entry is notified.
- Memory: Voting entries and cache bounded by (timeout × message_rate).
- Monotonic: No out-of-order ID assignments.
