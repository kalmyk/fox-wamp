declare class Deferred {
    resolve: (value?: any) => void;
    reject: (reason?: any) => void;
    cb: () => Promise<any>;
    constructor(cb: () => Promise<any>);
}
export declare class KPQueue {
    private keyLock;
    runDefer(strUri: string, defer: Deferred): void;
    enQueue(strUri: string, cb: () => Promise<any>): Promise<any>;
    deQueue(strUri: string): void;
}
export {};
