import { BaseRealm } from '../realm';
import { SqliteKvFabric } from './sqlitekv';
import FoxRouter from '../fox_router';
import { ProduceId } from '../masterfree/makeid';
import { DbFactory } from './dbfactory';
export declare class OneDbRouter extends FoxRouter {
    private makeId;
    private modKv;
    constructor(dbFactory: DbFactory);
    createRealm(realmName: string): BaseRealm;
    getMakeId(): ProduceId;
    getModKv(): SqliteKvFabric;
    startActualizePrefixTimer(): void;
}
