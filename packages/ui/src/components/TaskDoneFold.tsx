import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ICON } from "../lib/iconSizes";
import { readDoneFoldOpen, writeDoneFoldOpen } from "../lib/taskPlannerTree";
import { Row } from "./ui/GroupedRows";

/**
 * "Done (n)" under what is due (TestFlight wish of 2026-10-24, E5): a row of
 * the same card that folds the tasks finished on the day in and out. Closed
 * until someone opens it; whether it stands open is remembered by the device
 * (`readDoneFoldOpen`), for every list that shows it. The rows below it are the
 * caller's — the same rows it draws for open tasks, ticked — so unticking one
 * moves it back up.
 */
export function TaskDoneFold({ count, open, onToggle }: { count: number; open: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <Row
      className="pv-planner-donefold"
      icon={open ? <ChevronDown size={ICON.ui} /> : <ChevronRight size={ICON.ui} />}
      title={t("tasks.doneFold", { count })}
      onClick={onToggle}
      aria-expanded={open}
      data-testid="task-done-fold"
    />
  );
}

/** The fold's state as this device remembers it, and the press that flips it. */
export function useDoneFold(): [boolean, () => void] {
  const [open, setOpen] = useState(readDoneFoldOpen);
  const toggle = () => {
    writeDoneFoldOpen(!open);
    setOpen(!open);
  };
  return [open, toggle];
}
