import type { SessionRow } from "@/features/desk/types";
import { parseApiDate } from "@/lib/time";

export type ChatGroup = { label: string; items: SessionRow[] };

const DAY = 86_400_000;

function bucket(updatedAt: string | null | undefined, now: Date): string {
  const date = parseApiDate(updatedAt);
  if (!date) return "Earlier";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = date.getTime();
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - DAY) return "Yesterday";
  if (t >= startOfToday - 7 * DAY) return "Previous 7 days";
  return "Earlier";
}

function byPinned(a: SessionRow, b: SessionRow): number {
  const ta = parseApiDate(a.pinned_at)?.getTime() ?? 0;
  const tb = parseApiDate(b.pinned_at)?.getTime() ?? 0;
  return tb - ta;
}

export function groupChats(rows: SessionRow[], query: string): ChatGroup[] {
  const q = query.trim().toLowerCase();
  const now = new Date();
  const order = ["Today", "Yesterday", "Previous 7 days", "Earlier"];
  const map = new Map<string, SessionRow[]>();
  const pinned: SessionRow[] = [];
  for (const row of rows) {
    if (q && !(row.title || "").toLowerCase().includes(q)) continue;
    if (row.pinned) {
      pinned.push(row);
      continue;
    }
    const key = bucket(row.updated_at, now);
    map.set(key, [...(map.get(key) ?? []), row]);
  }
  const groups = order.filter((k) => map.has(k)).map((label) => ({ label, items: map.get(label)! }));
  if (pinned.length === 0) return groups;
  return [{ label: "Pinned", items: pinned.sort(byPinned) }, ...groups];
}
