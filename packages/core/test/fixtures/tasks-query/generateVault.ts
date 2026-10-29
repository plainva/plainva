/**
 * A generated vault for timing Tasks queries (plan Tasks-Abfragen, T0/E6):
 * `taskCount` tasks in notes of 20, spread over folders, headings, tags,
 * dates around today, priorities, states, recurrences and subtasks — the mix
 * of a large real vault. Deterministic: the same arguments give the same
 * notes, so a timing is comparable between runs.
 */

const TAGS = ["arbeit", "privat", "projekt/alpha", "projekt/beta", "rettediebahn", "lesen", "einkauf", "garten"];
const PRIORITY = ["", "", "", " 🔺", " ⏫", " 🔼", " 🔽", " ⏬"];
const FOLDERS = ["Arbeit", "Privat", "Projekte/Alpha", "Projekte/Beta", "Archiv", "Daily", "Inbox", "Notizen/2026", "Notizen/2025", "Ideen"];

/** A small linear congruential generator; enough to vary the notes. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function dayAround(today: string, offset: number): string {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
}

export function generateTaskVault(taskCount: number, today: string, seed = 44): Array<{ path: string; content: string }> {
  const next = random(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)];
  const notes: Array<{ path: string; content: string }> = [];
  let made = 0;
  for (let n = 0; made < taskCount; n++) {
    const lines: string[] = ["---", `created: ${today}`, "---", `# Note ${n}`, ""];
    for (let k = 0; k < 20 && made < taskCount; k++) {
      if (k % 7 === 0) lines.push("", `## Section ${k}`, "");
      const r = next();
      const box = r < 0.55 ? " " : r < 0.6 ? "/" : r < 0.93 ? "x" : "-";
      let text = `Task ${made} about ${pick(["the report", "the garden", "a call", "the invoice", "[[Some note]]", "**bold** work"])}`;
      if (next() < 0.6) text += ` #${pick(TAGS)}`;
      if (next() < 0.2) text += ` #${pick(TAGS)}`;
      text += pick(PRIORITY);
      if (next() < 0.1) text += ` 🔁 every ${pick(["day", "week", "month", "2 weeks"])}`;
      if (next() < 0.5) text += ` 📅 ${dayAround(today, Math.floor(next() * 120) - 60)}`;
      if (next() < 0.2) text += ` ⏳ ${dayAround(today, Math.floor(next() * 40) - 20)}`;
      if (next() < 0.1) text += ` 🛫 ${dayAround(today, Math.floor(next() * 40) - 20)}`;
      if (box === "x") text += ` ✅ ${dayAround(today, -Math.floor(next() * 90))}`;
      if (box === "-") text += ` ❌ ${dayAround(today, -Math.floor(next() * 90))}`;
      const indent = k > 0 && next() < 0.25 ? "  " : "";
      lines.push(`${indent}- [${box}] ${text}`);
      made++;
    }
    notes.push({ path: `${FOLDERS[n % FOLDERS.length]}/Note ${n}.md`, content: lines.join("\n") + "\n" });
  }
  return notes;
}
