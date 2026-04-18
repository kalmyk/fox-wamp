import * as sqlite from 'sqlite';
export declare class DbFactory {
    private activeDbs;
    private mainDb;
    private pathPrefix;
    constructor(pathPrefix: string | null);
    openDatabase(filename: string): Promise<sqlite.Database>;
    openMainDatabase(filename: string): Promise<sqlite.Database>;
    getDb(realmName: string): Promise<sqlite.Database>;
    getMainDb(): sqlite.Database;
    setMainDb(db: sqlite.Database): void;
    forEachDb(callback: (db: sqlite.Database, realmName: string) => Promise<void>): Promise<void>;
}
