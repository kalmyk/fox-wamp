import * as sqlite from 'sqlite';
export declare function forEachRealm(db: sqlite.Database, callback: (realmName: string) => Promise<void>): Promise<void>;
export declare function createHistoryTables(db: sqlite.Database, realmName: string): Promise<void>;
export declare function saveEventHistory(db: sqlite.Database, realmName: string, id: string, shard: number, uri: any, body: any, opt: any): Promise<sqlite.ISqlite.RunResult<import("sqlite3").Statement>>;
export declare function scanMaxId(db: sqlite.Database): Promise<string>;
export declare function getEventHistory(db: sqlite.Database, realmName: string, range: any, rowcb: any): Promise<number>;
