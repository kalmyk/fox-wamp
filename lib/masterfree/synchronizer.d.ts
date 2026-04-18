import { BaseRealm } from '../realm';
import { HyperClient } from '../hyper/client';
import { BODY_PICK_CHALLENGER, BODY_GENERATE_DRAFT, BODY_ELECT_SEGMENT } from './hyper.h';
type OwnerStateNode = {
    recentDraftSegment: string;
};
export declare class StageOneTask {
    private realm;
    private syncQuorum;
    private myId;
    private ownerState;
    private makeId;
    private recentValue;
    private advanceIdHeap;
    private doneHeap;
    private draftHeap;
    private api;
    private syncNodeIds;
    constructor(sysRealm: BaseRealm, myId: string, syncQuorum: number, syncNodeIds: string[]);
    getOwnerState(owner: string): OwnerStateNode;
    listenEntry(client: HyperClient): void;
    listenPeerStageOne(client: HyperClient): Promise<void>;
    event_generate_draft(body: BODY_GENERATE_DRAFT): void;
    event_pick_challenger(body: BODY_PICK_CHALLENGER): void;
    reconcilePos(segment: string, offset: number): boolean;
    startActualizePrefixTimer(): void;
    getRecentValue(): string;
    setRecentValue(newRecentValue: string): void;
    extractDraft(vouters: Set<string>): string;
}
export declare class StageTwoTask {
    private realm;
    private syncQuorum;
    private api;
    private readyQuorum;
    private recentValue;
    constructor(sysRealm: BaseRealm, syncQuorum: number);
    listenStageOne(client: HyperClient): void;
    event_elect_segment(body: BODY_ELECT_SEGMENT): void;
}
export {};
