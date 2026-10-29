/**
 * Desk-context builder smoke. Run:
 *   npx --yes tsx apps/cloud/tests/test_guide_context.ts
 */
import { buildDeskContext, sanitizeDeskHints } from "../src/guide/context";
import type { DeviceRow, DeviceView } from "../src/devices/service";
import type { Balance } from "../src/subscription/service";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const bal: Balance = {
  plan_id: "desk",
  plan_name: "Desk",
  price_label: "Per Jetson",
  status: "active",
  active: true,
  cloud_credit_usd: 3,
  cloud_spent_usd: 0.5,
  cloud_remaining_usd: 2.5,
  tavily_credits: 500,
  tavily_credits_spent: 10,
  tavily_credits_remaining: 490,
};

const selected: DeviceRow = {
  id: "d1",
  user_id: 1,
  name: "Kratos",
  hostname: "millie",
  remote_enabled: 1,
  connected_at: 1,
  disconnected_at: null,
  created_at: 1,
  board_emu: 0,
};

const fleet: DeviceView[] = [
  {
    id: "d1",
    name: "Kratos",
    hostname: "millie",
    agent_name: "Kratos",
    kind: "jetson",
    status: "online",
    remote_enabled: true,
    last_seen_at: null,
    agent_count: 0,
    board_emu: false,
  },
];

const hints = sanitizeDeskHints({
  secret_names: ["TEST", "evil;drop", "OK_KEY"],
  expert_names: ["Archivist"],
});
assert(hints.secret_names?.includes("TEST"), "keeps TEST");
assert(!hints.secret_names?.includes("evil;drop"), "drops unsafe name");
assert(hints.expert_names?.[0] === "Archivist", "expert name");

const block = buildDeskContext(fleet, selected, bal, hints);
assert(block.includes("Nano"), "models");
assert(block.includes("$2.50"), "credits");
assert(block.includes("TEST"), "secrets");
assert(block.includes("Archivist"), "experts");
assert(block.includes("Terminal=shell"), "ui legend");
assert(!block.includes("evil"), "no unsafe secret");

console.log("test_guide_context: ok");
