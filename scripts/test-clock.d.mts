// Types for test-clock.mjs (stability plan R9); the module itself documents the clock.
export declare const TEST_TIME_ZONE: string;
export declare const TEST_NOW_WALL: string;
export declare const TEST_NOW_MS: number;
export declare function pinTestTimeZone(): void;
export declare function wallTimeToEpochMs(wall: string, zone?: string): number;
export declare function realDateNow(): number;
export declare function installShiftedDate(startMs: number, realStartMs?: number): () => void;
export declare function useRealDate(): void;
export declare function installPageDate(anchor: { testMs: number; realMs: number }): void;
export declare function releasePageDate(): void;
