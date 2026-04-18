export type ComplexId = {
    dt: string;
    id: number;
};
export declare function keyComplexId(id: ComplexId): string;
export declare function keyDate(date: Date): string;
export declare function keyId(id: number): string;
export declare function mergeMax(a: ComplexId, b: ComplexId): ComplexId;
export declare function mergeMin(a: ComplexId, b: ComplexId): ComplexId;
export declare function makeEmpty(date: Date): ComplexId;
export declare class ProduceId {
    private prefix;
    private generator;
    private formatPrefix;
    constructor(formatPrefix: (date: Date) => string);
    reconcilePos(newPrefix: string, newPosition?: number): boolean;
    actualizePrefix(): boolean;
    generateIdRec(step?: number): ComplexId;
    generateIdStr(step?: number): string;
    reconcileStrId(encodedId: string): void;
}
