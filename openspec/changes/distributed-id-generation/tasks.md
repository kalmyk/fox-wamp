## 1. StageOne Refactoring (Remove Memory Leak)

- [ ] 1.1 Remove `draftHeap: Map<string, string[]>` from StageOneTask.
- [ ] 1.2 Add `votingEntries: Map<string, StageOneVotingEntry>` to track (advanceId → {minDraftId, voters, createdAt, result}).
- [ ] 1.3 Add `resolutionCache: Map<string, ResolutionCache>` to cache resolved advanceIds with TTL.
- [ ] 1.4 Update `event_pick_challenger()` to use stateless minimum tracking:
  - Check cache first for existing result.
  - Get or create voting entry for advanceId.
  - Update minDraftId if incoming draftId is smaller.
  - Add voter to voters Set.
  - Check quorum and publish ELECT_SEGMENT on completion.
- [ ] 1.5 Implement timeout check in `event_pick_challenger()`:
  - If (now() - entry.createdAt) > TIMEOUT_MS, discard entry and log warning.
- [ ] 1.6 Update `extractDraft()` method (or remove if no longer needed).
- [ ] 1.7 Add periodic cleanup task to purge expired cache entries (every 10s).

## 2. StageTwoTask Refactoring (Remove Memory Leak)

- [ ] 2.1 Remove `readyQuorum: Map<string, ReadyVouterChallenger>` from StageTwoTask.
- [ ] 2.2 Add `votingEntries: Map<string, StageTwoVotingEntry>` to track (advanceId → {maxChallenger, voters, createdAt, result}).
- [ ] 2.3 Add `resolutionCache: Map<string, ResolutionCache>` to cache resolved advanceIds with TTL.
- [ ] 2.4 Update `event_elect_segment()` to use stateless maximum tracking:
  - Check cache first for existing result.
  - Get or create voting entry for advanceId.
  - Update maxChallenger if incoming challenger is larger.
  - Add voter to voters Set.
  - Check quorum and publish ADVANCE_SEGMENT_RESOLVED on completion.
- [ ] 2.5 Implement timeout check in `event_elect_segment()`:
  - If (now() - entry.createdAt) > TIMEOUT_MS, discard entry, log error, publish ADVANCE_SEGMENT_FAILED.
- [ ] 2.6 Maintain `recentValue` tracking for monotonic ordering (already exists, verify it still works).
- [ ] 2.7 Add periodic cleanup task to purge expired cache entries (every 10s).

## 3. Collision Prevention

- [ ] 3.1 Implement resolution cache in both StageOne and StageTwoTask.
- [ ] 3.2 Before creating new voting entry, check if advanceId already has cached result.
- [ ] 3.3 If cached and not expired, return cached result immediately.
- [ ] 3.4 If cached but expired, delete from cache and treat as new.
- [ ] 3.5 When quorum reached, add entry to cache with (advanceId, finalId, resolvedAt, ttl=300000).
- [ ] 3.6 Implement cache expiry: entries older than TTL are purged during cleanup.

## 4. Timeout Enforcement

- [ ] 4.1 Define timeout constants:
  - STAGE_ONE_TIMEOUT_MS = 30000 (configurable)
  - STAGE_TWO_TIMEOUT_MS = 30000 (configurable)
  - CACHE_TTL_MS = 300000 (5 minutes)
  - CLEANUP_INTERVAL_MS = 10000 (every 10 seconds)
- [ ] 4.2 Add timeout check to StageOne `event_pick_challenger()`.
- [ ] 4.3 Add timeout check to StageTwoTask `event_elect_segment()`.
- [ ] 4.4 Log descriptive messages on timeout (advanceId, voter count, required quorum).
- [ ] 4.5 On StageTwoTask timeout, publish ADVANCE_SEGMENT_FAILED back to entry node.
- [ ] 4.6 Make timeouts configurable via constructor or config file.

## 5. Cleanup and Maintenance

- [ ] 5.1 Implement periodic cleanup function in StageOne.
- [ ] 5.2 Implement periodic cleanup function in StageTwoTask.
- [ ] 5.3 Start cleanup interval on initialization (every 10s).
- [ ] 5.4 Cleanup function: iterate cache, delete entries where (now() - resolvedAt) > ttl.
- [ ] 5.5 Add metrics/logging: track cache size, entries created, entries evicted.

## 6. Monotonic Ordering Verification

- [ ] 6.1 Verify `recentValue` tracking is correctly implemented.
- [ ] 6.2 Add assertion in StageTwoTask: new challenger must be >= recentValue.
- [ ] 6.3 Test that out-of-order challengers are rejected.
- [ ] 6.4 Test that IDs are monotonically non-decreasing across multiple segments.

## 7. Error Handling

- [ ] 7.1 Add error event: ADVANCE_SEGMENT_FAILED with reason (timeout, validation error, etc.).
- [ ] 7.2 Implement handler to send ADVANCE_SEGMENT_FAILED from StageTwoTask on timeout.
- [ ] 7.3 Entry node should receive ADVANCE_SEGMENT_FAILED and retry with new advance segment.
- [ ] 7.4 Log all timeout events with advanceId, voter count, timeout threshold.
- [ ] 7.5 Add telemetry for timeout events (count, frequency, affected advanceIds).

## 8. Testing: StageOne

- [ ] 8.1 Unit test: single vote reaches quorum, minimal ID selected.
- [ ] 8.2 Unit test: multiple votes, minimum correctly identified.
- [ ] 8.3 Unit test: duplicate votes deduplicated via Set.
- [ ] 8.4 Unit test: timeout if quorum not reached within 30s.
- [ ] 8.5 Unit test: cache hit returns result immediately on re-vote.
- [ ] 8.6 Unit test: cache expiry removes stale entries.
- [ ] 8.7 Integration test: StageOne publishes ELECT_SEGMENT when quorum reached.
- [ ] 8.8 Concurrency test: multiple advanceIds processed in parallel without interference.

## 9. Testing: StageTwoTask

- [ ] 9.1 Unit test: single vote reaches quorum, maximum challenger selected.
- [ ] 9.2 Unit test: multiple votes, maximum correctly identified.
- [ ] 9.3 Unit test: duplicate votes deduplicated via Set.
- [ ] 9.4 Unit test: timeout if quorum not reached within 30s.
- [ ] 9.5 Unit test: cache hit returns result immediately on re-vote.
- [ ] 9.6 Unit test: cache expiry removes stale entries.
- [ ] 9.7 Unit test: recentValue < new challenger is accepted.
- [ ] 9.8 Unit test: recentValue >= challenger is skipped.
- [ ] 9.9 Integration test: StageTwoTask publishes ADVANCE_SEGMENT_RESOLVED when quorum reached.
- [ ] 9.10 Concurrency test: multiple advanceIds processed in parallel without interference.

## 10. Testing: Collision Prevention

- [ ] 10.1 Unit test: same advanceId queued twice returns cached result.
- [ ] 10.2 Unit test: advanceId result is consistent across multiple invocations.
- [ ] 10.3 Unit test: no duplicate IDs issued for same advanceId.
- [ ] 10.4 Integration test: entry node retransmits PICK_CHALLENGER, receives same result from cache.
- [ ] 10.5 Load test: high message rate (1000+ msg/s), cache size stays bounded.

## 11. Testing: Timeout Behavior

- [ ] 11.1 Unit test: entry created, no votes for 30s, discarded on timeout.
- [ ] 11.2 Unit test: entry created with 1 vote, 2nd vote arrives after 30s, discarded as timeout.
- [ ] 11.3 Unit test: entry with quorum at 29s completes successfully (before timeout).
- [ ] 11.4 Integration test: StageOne timeout → entry retries with new segment.
- [ ] 11.5 Integration test: StageTwoTask timeout → ADVANCE_SEGMENT_FAILED sent to entry.
- [ ] 11.6 Timeout configuration test: custom timeouts are respected (e.g., 60s, 120s).

## 12. Testing: Monotonic Ordering

- [ ] 12.1 Unit test: finalId1 <= finalId2 for consecutive advanceIds.
- [ ] 12.2 Unit test: out-of-order challenger rejected (< recentValue).
- [ ] 12.3 Integration test: 100 messages generate monotonically increasing IDs.
- [ ] 12.4 Stress test: concurrent entries from multiple nodes, all IDs monotonic.

## 13. Memory and Performance

- [ ] 13.1 Memory benchmark: voting entries (before: unlimited, after: bounded by timeout × rate).
- [ ] 13.2 Memory benchmark: cache size at 100 msg/s over 1 hour (should be ~100K entries max).
- [ ] 13.3 Performance test: latency from vote to quorum (p50, p99).
- [ ] 13.4 Performance test: cache lookup performance (should be O(1) map access).
- [ ] 13.5 Verify: no memory leak over 24-hour sustained load test.

## 14. Documentation

- [ ] 14.1 Add code comments explaining stateless voting approach.
- [ ] 14.2 Document timeout configuration options.
- [ ] 14.3 Document error codes: timeout, quorum loss, validation failure.
- [ ] 14.4 Document troubleshooting: how to diagnose and resolve timeout issues.
- [ ] 14.5 Update distributed-mode.md with new voting protocol.

## 15. Deployment and Cutover

- [ ] 15.1 Add feature flag (if needed) to enable new voting logic.
- [ ] 15.2 Create migration guide: old cluster → new cluster upgrade procedure.
- [ ] 15.3 Add rollback plan: procedure to revert if issues found post-deployment.
- [ ] 15.4 Staging test: deploy to staging environment, run full test suite.
- [ ] 15.5 Canary deployment: gradually roll out to production (if applicable).
