import React, { useState } from "react";
import { AreaBoundary } from "@plainva/ui";

/**
 * A page of the settings. `whenOpened`: its content mounts the first time the page is shown, not with the dialog —
 * the AI's pages, whose code is the harness's and loads with them (review of L5, round 2, 2026-11-25: opening the
 * settings loaded 222 modules of the AI with the dialog).
 */
export const SettingsPage: React.FC<{ area: string; active: boolean; whenOpened?: boolean; children: React.ReactNode }> = ({ area, active, whenOpened, children }) => {
  const [opened, setOpened] = useState(active);
  if (active && !opened) setOpened(true);
  return (
    <div className="pv-setpage custom-scrollbar" data-active={active ? "true" : "false"}>
      {/* Every page an area of its own (stability plan R3): a page that fails
          leaves the settings, their navigation and every other page. */}
      <AreaBoundary area={`settings:${area}`}>{!whenOpened || opened ? <React.Suspense fallback={null}>{children}</React.Suspense> : null}</AreaBoundary>
    </div>
  );
};
