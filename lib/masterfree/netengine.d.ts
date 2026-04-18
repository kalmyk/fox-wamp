import { ActorPush, BaseEngine } from '../realm';
import { AdvanceOffsetId, BODY_TRIM_ADVANCE_SEGMENT } from './hyper.h';
export declare class HistorySegment {
    private content;
    private advanceSegment;
    private generator;
    private shard;
    constructor(advanceSegment: string, shard?: number);
    getShard(): number;
    size(): number;
    getDestinationTopics(): Array<string>;
    addActorPush(actor: ActorPush): AdvanceOffsetId;
    fetchActor(advanceId: AdvanceOffsetId): ActorPush | undefined;
    getAdvanceSegment(): string;
}
export declare class NetEngine extends BaseEngine {
    private netEngineMill;
    constructor(netEngineMill: NetEngineMill);
    doPush(actor: ActorPush): Promise<any[]>;
    getHistoryAfter(after: string, uri: string, cbEmitRow: any): Promise<any>;
}
export declare class NetEngineMill {
    private curSegment;
    private advanceSegmentGen;
    private segments;
    private router;
    private sysRealm;
    private sysApi;
    private lastShard;
    constructor(router: any);
    nextShard(): number;
    event_trim_advance_segment(data: BODY_TRIM_ADVANCE_SEGMENT): void;
    getSegment(): HistorySegment;
    findSegment(advanceSegment: string): HistorySegment | undefined;
    deleteSegment(advanceSegment: string): boolean;
    advance_segment_resolved(syncMessage: any): void;
    saveHistory(actor: ActorPush, realmName: string): Promise<any[]>;
    dispatchEvent(eventData: any): void;
}
