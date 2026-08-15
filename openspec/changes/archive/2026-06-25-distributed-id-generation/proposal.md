## Why

The current distributed ID generation system uses permanent in-memory heaps to accumulate voting data across multiple synchronization stages. This design has two critical issues:

1. **Memory Leak in StageOne** — `draftHeap` accumulates all generated draft IDs indefinitely. While pruning happens during extraction, entries can build up faster than they're cleaned.
2. **Memory Leak in StageTwo** — `readyQuorum` accumulates entries for every advance segment ID. Entries are only deleted when quorum is reached, but segments that don't reach quorum (edge cases, network failures) stay in memory forever.
3. **No Timeout** — Segments without sufficient quorum have no expiration mechanism, allowing indefinite accumulation.

The system should generate consensus IDs using stateless sorting and validation, not persistent memory structures. Each stage should:
- Accept voter/challenger inputs
- Validate and sort in real-time
- Produce a result when quorum is reached
- Discard temporary state immediately

## What Changes

- Refactor **StageOne** to replace `draftHeap` with stateless minimal-value tracking per advance segment.
- Refactor **StageTwo** to replace `readyQuorum` with stateless maximum-value tracking per advance segment.
- Add timeout/expiry for segments that don't reach quorum within a bounded time window.
- Maintain no persistent memory of individual draft IDs or challenger values after result is generated.
- Ensure no resending of collision IDs (once an ID is resolved, it is never regenerated).

## Capabilities

### Modified Capabilities

- `distributed-id-generation`: Replace persistent heap-based voting with stateless sorting and validation. Enforce quorum-based consensus without long-lived accumulation structures.

## Impact

- **Memory efficiency**: Reduce memory footprint of synchronization layer by eliminating unbounded heap growth.
- **Fault tolerance**: Add timeout mechanisms so segments stuck without quorum don't accumulate forever.
- **Code simplicity**: Stateless sorting is easier to reason about and test.
- Updates to `StageOneTask` and `StageTwoTask` in `lib/masterfree/synchronizer.ts`.
- New timeout tracking and expiry logic in both stages.

## Architecture: Stateless Voting with Quorum

### StageOne (Minimal Value Selection)

```
For each advance segment:
  - Accept PICK_CHALLENGER from N sync nodes
  - Track minimum draft ID seen from each voter
  - Once M voters (quorum) have voted:
    * Select minimum draft ID
    * Publish ELECT_SEGMENT to StageTwo
    * Discard all temporary state for this segment
  - If quorum not reached within timeout (e.g., 30s):
    * Log error
    * Discard segment data
    * Send error back to entry node
```

### StageTwo (Maximum Value Selection)

```
For each advance segment:
  - Accept ELECT_SEGMENT from N StageOne nodes
  - Track maximum challenger value seen from each voter
  - Once M voters (quorum) have voted:
    * Select maximum challenger
    * Publish ADVANCE_SEGMENT_RESOLVED
    * Discard all temporary state for this segment
  - If quorum not reached within timeout (e.g., 30s):
    * Log error
    * Discard segment data
    * Send error back to entry node
```

### Collision Prevention

Once an `advanceId` (`advanceOwner:advanceStamp`) is resolved to a final ID:
- Store the resolution in a time-bounded cache (e.g., 5 minutes)
- If the same `advanceId` arrives again, return the cached result instead of regenerating
- This ensures no duplicate IDs are issued for the same advance segment

## Risks / Trade-offs

- **Timeout calibration** — Too short and slow networks will lose segments; too long and memory still accumulates. Recommendation: Start with 30-60s based on cluster latency.
- **Retry logic** — If a segment times out, entry nodes must retry with a new advance segment. Need clear error semantics.
- **Cache size** — Time-bounded resolution cache for collision prevention needs bounded size; old entries should be pruned after TTL.
