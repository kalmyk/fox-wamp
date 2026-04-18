import { BaseEngine, ActorPush } from '../realm';
import { SqliteKvFabric } from './sqlitekv';
import { ProduceId } from '../masterfree/makeid';
export declare class DbEngine extends BaseEngine {
    private idMill;
    private modKv;
    constructor(idMill: ProduceId, modKv: SqliteKvFabric);
    launchEngine(realmName: string): Promise<void>;
    doPush(actor: ActorPush): Promise<void>;
    saveHistory(actor: ActorPush): Promise<any>;
    getHistoryAfter(after: string, uri: any, cbRow: (row: any) => void): Promise<any>;
}
