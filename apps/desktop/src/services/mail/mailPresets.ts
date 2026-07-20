/**
 * Mail provider presets — the data moved into the shared provider catalog
 * (`@plainva/ui` providerCatalog, stage A+ 2026-07-20) so the wizard tiles,
 * the family detection and the presets stay single-sourced. This module only
 * re-exports for the existing desktop import sites.
 */

export { MAIL_PRESETS, presetById, presetForEmail, type MailPreset } from "@plainva/ui";
