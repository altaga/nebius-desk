/**
 * Tiny parse regression for Millie fences. Run:
 *   npx --yes tsx apps/cloud/tests/test_guide_parse.ts
 */
import { parseGuideReply, polishGuideTurn } from "../src/guide/actions";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const spoken = parseGuideReply(`Opened Terminal — type: df -h
\`\`\`guide
{"actions":[{"type":"react","emotion":"determined"},{"type":"open_terminal"},{"type":"highlight","target":"machine.terminal"}]}
\`\`\``);
assert(spoken.text.includes("df -h"), "keeps spoken line");
assert(spoken.actions.some((a) => a.type === "open_terminal"), "parses open_terminal");
assert(spoken.actions.some((a) => a.type === "highlight" && a.target === "machine.terminal"), "parses highlight");

const badTarget = parseGuideReply(`Nope
\`\`\`guide
{"actions":[{"type":"react","emotion":"happy"},{"type":"highlight","target":"evil.css"}]}
\`\`\``);
assert(badTarget.actions.every((a) => a.type !== "highlight"), "drops unknown highlight");

const toolsOnly = parseGuideReply(`\`\`\`guide
{"actions":[{"type":"react","emotion":"shy"}]}
\`\`\``);
assert(toolsOnly.text === "", "strips fence-only");
assert(toolsOnly.actions[0]?.emotion === "shy", "react survives");

// "Hello Mills" (typo) must not echo the user in the bubble.
const hello = polishGuideTurn("Hello Mills", "Hello Mills", [{ type: "react", emotion: "happy" }]);
assert(!/hello\s+mills/i.test(hello.text), "does not echo Hello Mills");
assert(/millie/i.test(hello.text), "greets as Millie");
assert(hello.actions.every((a) => a.type === "react"), "greeting stays react-only");

// "abre services de Kratos" must open Services (not Terminal) on that board.
const kratosSvc = polishGuideTurn(
  "abre services de Kratos",
  "Sure",
  [{ type: "react", emotion: "happy" }],
  {
    boardName: "Natasha",
    fleet: [
      { name: "Kratos", status: "online" },
      { name: "Natasha", status: "online" },
    ],
  }
);
assert(
  kratosSvc.actions.some((a) => a.type === "select_board" && a.board === "Kratos"),
  "switches to Kratos"
);
assert(kratosSvc.actions.some((a) => a.type === "open_browser"), "opens Services (open_browser)");
assert(
  kratosSvc.actions.some((a) => a.type === "highlight" && a.target === "machine.services"),
  "highlights machine.services"
);
assert(/services/i.test(kratosSvc.text), "speaks about Services");

// Same-board "open services" without naming another board.
const localSvc = polishGuideTurn("open services", "", [{ type: "react", emotion: "happy" }], {
  boardName: "Kratos",
  fleet: [{ name: "Kratos", status: "online" }],
});
assert(localSvc.actions.some((a) => a.type === "open_browser"), "opens Services on current board");
assert(
  localSvc.actions.some((a) => a.type === "highlight" && a.target === "machine.services"),
  "highlights services"
);

const newChat = polishGuideTurn("nuevo chat", "", [{ type: "react", emotion: "happy" }], {
  boardName: "Kratos",
  fleet: [{ name: "Kratos", status: "online" }],
});
assert(newChat.actions.some((a) => a.type === "new_chat"), "starts new_chat");

const files = polishGuideTurn("abre files", "", [{ type: "react", emotion: "happy" }], {
  boardName: "Kratos",
  fleet: [{ name: "Kratos", status: "online" }],
});
assert(files.actions.some((a) => a.type === "open_files"), "opens files");
assert(files.actions.some((a) => a.type === "highlight" && a.target === "machine.files"), "highlights files");

const health = polishGuideTurn("dónde está health", "", [{ type: "react", emotion: "happy" }], {
  boardName: "Kratos",
  fleet: [{ name: "Kratos", status: "online" }],
});
assert(health.actions.some((a) => a.type === "open_health"), "opens health");

console.log("test_guide_parse: ok");
