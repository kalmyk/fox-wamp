## 1. StageOne Refactoring (Remove Memory Leak)

- [x] 1.1 Remove `draftHeap: Map<string, string[]>` from StageOneTask.
- [x] 1.2 Add `votingEntries: Map<string, StageOneVotingEntry>` to track (advanceId → {minDraftId, voters}).
- [x] 1.3 Add `advanceOwnerState: Map<string, {recentAdvanceSegment}>` for monotonic late-vote guard (replaces resolutionCache TTL approach).
- [x] 1.4 Update `event_pick_challenger()` to use stateless minimum tracking:
  - Guard: if `recentAdvanceSegment[owner] > advanceStamp`, skip (segment already resolved).
  - Get or create voting entry for advanceId.
  - Update minDraftId if incoming draftId is smaller.
  - Add voter to voters Set.
  - Check quorum and publish ELECT_SEGMENT on completion.
- [x] 1.5 StageOne has no periodic cleanup — stale entries are deleted in `event_generate_draft` when entry advances past previous segment.
- [x] 1.6 Update `extractDraft()` method (or remove if no longer needed).
- [x] 1.7 Delete previous segment's voting entry in `event_generate_draft` when `recentAdvanceSegment` advances.

## 2. StageTwoTask Refactoring (Remove Memory Leak)

- [x] 2.1 Remove `readyQuorum: Map<string, ReadyVouterChallenger>` from StageTwoTask.
- [x] 2.2 Add `votingEntries: Map<string, StageTwoVotingEntry>` to track (advanceId → {maxChallenger, voters, createdAt}).
- [x] 2.3 No resolutionCache needed — `recentValue` monotonic guard handles duplicate suppression.
- [x] 2.4 Update `event_elect_segment()` to use stateless maximum tracking:
  - Guard: if `challenger < recentValue`, skip (monotonic ordering).
  - Lazy eviction: if `createdAt` exceeds timeoutMs, discard and publish ADVANCE_SEGMENT_FAILED.
  - Get or create voting entry for advanceId.
  - Update maxChallenger if incoming challenger is larger.
  - Add voter to voters Set.
  - Check quorum and publish ADVANCE_SEGMENT_RESOLVED on completion.
- [x] 2.5 Implement lazy timeout eviction in `event_elect_segment()` (on next incoming vote, not a timer).
- [x] 2.6 Maintain `recentValue` tracking for monotonic ordering (already exists, verify it still works).
- [x] 2.7 No periodic cleanup interval needed — stale entries are lazily evicted in event handler.

## 3. Collision Prevention

- [x] 3.1 StageOne: use `recentAdvanceSegment[owner] > advanceStamp` to discard late votes.
- [x] 3.2 StageOne: delete stale voting entry for previous segment in `event_generate_draft`.
- [x] 3.3 StageTwo: use `challenger < recentValue` guard in `event_elect_segment`.
- [x] 3.4 StageTwo: lazy timeout eviction prevents lingering unresolved entries.
- [x] 3.5 Both stages: `voters: Set<nodeId>` deduplicates concurrent duplicate votes.
- [x] 3.6 Voting entry deleted immediately on quorum — no residual state after resolution.

## 4. Timeout Enforcement

- [x] 4.1 Define timeout constants:
  - STAGE_TWO_TIMEOUT_MS = 30000 (configurable via constructor options)
  - StageOne has no timeout — monotonic segment advance is the cleanup mechanism
- [x] 4.2 StageOne has no explicit timeout check — late votes are dropped by `recentAdvanceSegment` guard.
- [x] 4.3 Add lazy timeout check to StageTwoTask `event_elect_segment()`.
- [x] 4.4 Log descriptive messages on timeout (advanceId, voter count, required quorum).
- [x] 4.5 On StageTwoTask timeout, publish ADVANCE_SEGMENT_FAILED back to entry node.
- [x] 4.6 Make timeouts configurable via constructor or config file.

## 5. Cleanup and Maintenance

- [x] 5.1 StageOne: stale voting entries cleaned up in `event_generate_draft` (no timer needed).
- [x] 5.2 StageTwoTask: stale voting entries lazily evicted in `event_elect_segment` on next vote arrival.
- [x] 5.3 No setInterval cleanup — both stages are driven by event flow, not background timers.
- [x] 5.4 Cleanup: StageOne deletes `votingEntries.get(owner + ':' + prevSegment)` when advancing segment.
- [ ] 5.5 Add metrics/logging: track votingEntries size, entries created, entries evicted.

## 6. Monotonic Ordering Verification

- [x] 6.1 Verify `recentValue` tracking is correctly implemented.
- [x] 6.2 Add assertion in StageTwoTask: new challenger must be >= recentValue.
- [x] 6.3 Test that out-of-order challengers are rejected.
- [x] 6.4 Test that IDs are monotonically non-decreasing across multiple segments.

## 7. Error Handling

- [x] 7.1 Add error event: ADVANCE_SEGMENT_FAILED with reason (timeout, validation error, etc.).
- [x] 7.2 Implement handler to send ADVANCE_SEGMENT_FAILED from StageTwoTask on timeout.
- [x] 7.3 Entry node should receive ADVANCE_SEGMENT_FAILED and retry with new advance segment.
- [x] 7.4 Log all timeout events with advanceId, voter count, timeout threshold.
- [ ] 7.5 Add telemetry for timeout events (count, frequency, affected advanceIds).

## 8. Testing: StageOne

- [x] 8.1 Unit test: single vote reaches quorum, minimal ID selected.
- [x] 8.2 Unit test: multiple votes, minimum correctly identified.
- [x] 8.3 Unit test: duplicate votes deduplicated via Set.
- [ ] 8.4 Unit test: timeout if quorum not reached within 30s.
- [x] 8.5 Unit test: late vote for already-advanced segment is skipped by `recentAdvanceSegment` guard.
- [x] 8.6 Unit test: stale voting entry for previous segment is cleaned up when entry advances.
- [x] 8.7 Integration test: StageOne publishes ELECT_SEGMENT when quorum reached.
- [x] 8.8 Concurrency test: multiple advanceIds processed in parallel without interference.

## 9. Testing: StageTwoTask

- [x] 9.1 Unit test: single vote reaches quorum, maximum challenger selected.
- [x] 9.2 Unit test: multiple votes, maximum correctly identified.
- [x] 9.3 Unit test: duplicate votes deduplicated via Set.
- [x] 9.4 Unit test: timeout if quorum not reached within 30s.
- [x] 9.5 Unit test: late vote for same advanceId after quorum is not re-resolved (votingEntry deleted).
- [x] 9.6 Unit test: `recentValue` guard drops challengers below resolved threshold.
- [x] 9.7 Unit test: recentValue < new challenger is accepted.
- [x] 9.8 Unit test: recentValue >= challenger is skipped.
- [x] 9.9 Integration test: StageTwoTask publishes ADVANCE_SEGMENT_RESOLVED when quorum reached.
- [x] 9.10 Concurrency test: multiple advanceIds processed in parallel without interference.

## 10. Testing: Collision Prevention

- [x] 10.1 Unit test: same advanceId queued twice returns cached result.
- [x] 10.2 Unit test: advanceId result is consistent across multiple invocations.
- [x] 10.3 Unit test: no duplicate IDs issued for same advanceId.
- [ ] 10.4 Integration test: entry node retransmits PICK_CHALLENGER, receives same result from cache.
- [ ] 10.5 Load test: high message rate (1000+ msg/s), cache size stays bounded.

## 11. Testing: Timeout Behavior

- [ ] 11.1 Unit test: entry created, no votes for 30s, discarded on timeout.
- [ ] 11.2 Unit test: entry created with 1 vote, 2nd vote arrives after 30s, discarded as timeout.
- [ ] 11.3 Unit test: entry with quorum at 29s completes successfully (before timeout).
- [ ] 11.4 Integration test: StageOne timeout → entry retries with new segment.
- [x] 11.5 Integration test: StageTwoTask timeout → ADVANCE_SEGMENT_FAILED sent to entry.
- [ ] 11.6 Timeout configuration test: custom timeouts are respected (e.g., 60s, 120s).

## 12. Testing: Monotonic Ordering

- [x] 12.1 Unit test: finalId1 <= finalId2 for consecutive advanceIds.
- [x] 12.2 Unit test: out-of-order challenger rejected (< recentValue).
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
- [x] 14.5 Update distributed-mode.md with new voting protocol.

## 15. Deployment and Cutover

- [ ] 15.1 Add feature flag (if needed) to enable new voting logic.
- [ ] 15.2 Create migration guide: old cluster → new cluster upgrade procedure.
- [ ] 15.3 Add rollback plan: procedure to revert if issues found post-deployment.
- [ ] 15.4 Staging test: deploy to staging environment, run full test suite.
- [ ] 15.5 Canary deployment: gradually roll out to production (if applicable).
