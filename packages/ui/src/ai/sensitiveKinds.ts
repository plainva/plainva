import { useTranslation } from "react-i18next";
import type { SensitiveKind } from "@plainva/core";

/**
 * The kinds a sensitivity hint names (plan KI-Harness P2b-6), in the
 * reader's language and joined like the overview's other lists:
 * "password or key · account number".
 */
export function useSensitiveKinds(): (kinds: readonly SensitiveKind[]) => string {
  const { t } = useTranslation();
  return (kinds) => kinds.map((kind) => t(`ai.lens.sensitiveKind.${kind}`)).join(" · ");
}
