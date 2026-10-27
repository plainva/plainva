/** Types of `e2e-build-env.mjs`: the e2e build's environment, empty for every other mode. */
export declare const E2E_BUILD_MODE: "e2e";
export declare const E2E_STANDARD_GOOGLE_IOS_CLIENT_ID: string;
export declare function e2eBuildEnv(mode: string): Record<string, string>;
export declare function e2eBuildDefine(mode: string): Record<string, string>;
