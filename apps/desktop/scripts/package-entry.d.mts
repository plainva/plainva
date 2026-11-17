export const MAIN: string;
export const HELPER: string;
export function desktopCommand(text: string): string[] | undefined;
export function desktopExec(text: string): string | undefined;
export function plistString(xml: string, key: string): string | undefined;
export function checkLinuxTree(root: string, options?: { appimage?: boolean }): string[];
export function readPlist(path: string, convert?: (file: string) => string): { xml: string } | { error: string };
export function checkMacApp(app: string, options?: { convert?: (file: string) => string }): string[];
export function partSizes(root: string): { path: string; bytes: number }[];
