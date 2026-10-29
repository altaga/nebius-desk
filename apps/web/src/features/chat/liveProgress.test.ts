import { describe, expect, it } from "vitest";
import { activityItems, applyToolEvent, formatElapsed, labelForTool } from "./liveProgress";

describe("liveProgress", () => {
  it("labels shell and install tools", () => {
    expect(labelForTool({ kind: "run", command: "npm create vite@latest app" })).toBe("npm create vite@latest app");
    expect(labelForTool({ kind: "install", tool: "node" })).toBe("Install node");
    expect(labelForTool({ kind: "read", path: "src/App.tsx" })).toBe("Read src/App.tsx");
  });

  it("groups consecutive shell runs", () => {
    const steps = [
      { id: "1", kind: "run", label: "ls", status: "ok" as const },
      { id: "2", kind: "run", label: "pwd", status: "ok" as const },
      { id: "3", kind: "read", label: "Read notes.txt", status: "ok" as const },
    ];
    const items = activityItems(steps);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ type: "commands" });
    expect(items[1]).toMatchObject({ type: "step" });
  });

  it("tracks start then done", () => {
    let steps = applyToolEvent([], { phase: "start", kind: "run", command: "ls" }, 1);
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("running");
    steps = applyToolEvent(steps, { phase: "done", kind: "run", command: "ls", ok: true, exit_code: 0 }, 2);
    expect(steps[0].status).toBe("ok");
  });

  it("formats elapsed", () => {
    expect(formatElapsed(1500)).toBe("1.5s");
    expect(formatElapsed(125000)).toBe("2:05");
  });
});
