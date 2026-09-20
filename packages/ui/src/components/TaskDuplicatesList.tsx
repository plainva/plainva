import { useTranslation } from "react-i18next";
import { CheckSquare, Square } from "lucide-react";
import { ICON } from "../lib/iconSizes";
import { noteDisplayName } from "../lib/noteTitle";
import type { TaskCopyVerdict, TaskDuplicateGroup } from "../pim/taskDuplicates";
import { Chip } from "./ui/Chip";
import { GroupCard, Row, RowList, SectionLabel } from "./ui/GroupedRows";

/**
 * The body of "Tasks that exist more than once" (finding 2026-09-20): one card
 * per task, the kept note first, every copy with what will happen to it and
 * why. Shared by both shells — the desktop puts it into a Modal, the phone into
 * a sheet; what a verdict MEANS must read the same on both. Built from the
 * container grammar (SectionLabel, GroupCard, Row), so it has no look of its
 * own to keep in step with the themes.
 *
 * Deliberately no per-copy switches: the rule is conservative enough to be
 * applied as a whole, and a copy that needs a decision is exactly the one the
 * rule already leaves alone. A row opens its note to look at it.
 */
const VERDICT_KEY: Record<TaskCopyVerdict, string> = {
  kept: "tasks.duplicatesKept",
  removable: "tasks.duplicatesRemovable",
  ownText: "tasks.duplicatesOwnText",
  differs: "tasks.duplicatesDiffers",
  unreadable: "tasks.duplicatesDiffers",
};

const VERDICT_TONE: Record<TaskCopyVerdict, "default" | "muted" | "warning"> = {
  kept: "default",
  removable: "warning",
  ownText: "muted",
  differs: "muted",
  unreadable: "muted",
};

export interface TaskDuplicatesListProps {
  groups: readonly TaskDuplicateGroup[];
  onOpen?: (path: string) => void;
}

export function TaskDuplicatesList({ groups, onOpen }: TaskDuplicatesListProps) {
  const { t } = useTranslation();
  return (
    <div className="pv-dupes" data-testid="task-duplicates">
      {groups.map((group) => (
        <section key={group.key}>
          <SectionLabel end={group.notes.length}>{noteDisplayName(group.title)}</SectionLabel>
          <GroupCard>
            <RowList>
              {group.notes.map((note) => (
                <Row
                  key={note.path}
                  wrap
                  data-verdict={note.verdict}
                  data-tip={note.path}
                  icon={note.done ? <CheckSquare size={ICON.ui} /> : <Square size={ICON.ui} />}
                  title={noteDisplayName(note.path.split("/").pop() ?? note.path)}
                  subtitle={
                    <Chip size="sm" tone={VERDICT_TONE[note.verdict]}>
                      {t(VERDICT_KEY[note.verdict])}
                    </Chip>
                  }
                  onClick={onOpen ? () => onOpen(note.path) : undefined}
                />
              ))}
            </RowList>
          </GroupCard>
        </section>
      ))}
    </div>
  );
}
