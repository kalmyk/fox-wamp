import { BaseRealm } from '../realm';
import { ComplexId } from './makeid';
import { HyperClient } from '../hyper/client';
import { DbFactory } from '../sqlite/dbfactory';
import { BODY_KEEP_ADVANCE_HISTORY } from './hyper.h';
export declare class HistoryBuffer {
    private content;
    private shard;
    constructor(shard: number);
    getShard(): number;
    addEvent(event: BODY_KEEP_ADVANCE_HISTORY): void;
    getContent(): Array<BODY_KEEP_ADVANCE_HISTORY>;
    count(): number;
}
export declare class StorageTask {
    private sysRealm;
    private dbFactory;
    private maxId;
    private bufferToWrite;
    private api;
    private realms;
    constructor(sysRealm: BaseRealm, dbFactory: DbFactory);
    getMaxId(): ComplexId;
    listenEntry(client: HyperClient, gateId: string): Promise<void>;
    listenStageOne(client: HyperClient): Promise<void>;
    listenStageTwo(client: HyperClient): Promise<void>;
    getHystoryBuffer(segment: string, shard: number): HistoryBuffer;
    event_keep_advance_history(event: BODY_KEEP_ADVANCE_HISTORY): Promise<void>;
    commit_segment(advanceSegment: string, segment: string): void;
    dbSaveSegment(historyBuffer: HistoryBuffer, segment: string): string[];
}
