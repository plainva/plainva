/**
 * The value with its first letter in capitals, typed as such — for a
 * translation key built from it (`settingsSync.diag${capitalize(state)}`).
 * Spelled out with `charAt(0).toUpperCase()`, the key's type was an open
 * `string`, and nobody could see which keys it can make (F53 of release
 * 0.9.0: four of them were missing in every language). Through `Capitalize`
 * the checker sees each one (`composedLocaleKeys.test.ts`).
 */
export function capitalize<T extends string>(value: T): Capitalize<T> {
  return (value.charAt(0).toUpperCase() + value.slice(1)) as Capitalize<T>;
}
