import * as sqlite from 'sqlite';
import { KeyValueStorageAbstract } from '../realm';
import { DbFactory } from './dbfactory';
import { ActorPush } from '../realm';
import { ProduceId } from '../masterfree/makeid';
export declare function createKvTables(db: sqlite.Database, realmName: string): Promise<void>;
export declare function saveUpdateHistory(db: sqlite.Database, realmName: string, id: string, origin: string, suri: string, oldv: any): Promise<sqlite.ISqlite.RunResult<import("sqlite3").Statement>>;
export declare class SqliteKvFabric {
    private pkq;
    private makeId;
    private dbFactory;
    constructor(dbFactory: DbFactory, makeId: ProduceId);
    getDb(realmName: string): Promise<sqlite.Database>;
    eraseSessionData(realmName: string, sessionId: string, runInboundEvent: (sid: string, key: string[], will: any) => void): Promise<void>;
    setKeyValue(realmName: string, suri: string, origin: string, data: any, opt: any, sid: string, pubOutEvent: (kind: string, outEvent: any) => void): Promise<any>;
    applySegment(segment: any[], pubOutEvent: (kind: string, outEvent: any) => void): Promise<void>;
    getKey(realmName: string, uri: string[], cbRow: (key: string[], data: any, stamp: string) => void): Promise<any>;
}
export declare class SqliteKv extends KeyValueStorageAbstract {
    private mod;
    private realmName;
    constructor(mod: SqliteKvFabric, realmName: string);
    eraseSessionData(sessionId: string): Promise<void>;
    setKeyActor(actor: ActorPush): Promise<any>;
    getKey(uri: [string], cbRow: any): Promise<any>;
}
