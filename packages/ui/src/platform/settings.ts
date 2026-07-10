/**
 * Platform-neutral settings access (ADR 0011). The desktop shell backs this
 * with the Tauri store plugin, the mobile shell will use Capacitor
 * preferences. The shape mirrors exactly the subset of the Tauri Store API
 * the app uses, so the desktop adapter is the plugin store instance itself.
 */
export interface ISettingsStore {
  get<T>(key: string): Promise<T | undefined | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  keys(): Promise<string[]>;
  save(): Promise<void>;
}
