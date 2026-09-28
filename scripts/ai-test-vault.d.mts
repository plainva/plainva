export declare const LANGUAGES: string[];
export declare const LOCKED_FACTS: string[];
export interface GoldenQuery {
  id: string;
  lang: string;
  query: string;
  expect: string[];
  fact?: string;
  mustNotContain?: string[];
  locked?: string[];
  injection?: boolean;
  sensitive?: boolean;
  today?: string;
}
export declare function aiTestVaultFiles(): { files: Array<[string, string]>; golden: GoldenQuery[] };
