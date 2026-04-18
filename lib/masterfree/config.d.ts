export declare class Config {
    private config;
    loadConfigFile(configFileName: string): Promise<void>;
    getEntryNodes(): any;
    getSyncNodes(): any;
    getSyncById(nodeId: string): any;
    getGateById(nodeId: string): any;
    getSyncQuorum(): any;
}
export declare function getConfigInstance(): Config;
export declare function setConfigInstance(config: Config): void;
