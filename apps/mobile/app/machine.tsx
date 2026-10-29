import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api, setActiveBoard } from "@/lib/api";

type Tab = "cli" | "files" | "board" | "terminal";

export default function MachineScreen() {
  const [tab, setTab] = useState<Tab>("cli");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [board, setBoard] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api()
      .listDevices()
      .then((rows) => {
        const first = rows[0];
        if (!first) return;
        setDeviceId(first.id);
        setBoard(first.name);
        setActiveBoard(first.id);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "No board"));
  }, []);

  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
        <Text style={styles.title}>{board || "Board"}</Text>
      </View>
      <View style={styles.tabs}>
        {(
          [
            ["cli", "CLI"],
            ["terminal", "Terminal"],
            ["files", "Files"],
            ["board", "Rename"],
          ] as const
        ).map(([id, label]) => (
          <Pressable key={id} onPress={() => setTab(id)} style={tab === id ? styles.tabOn : styles.tab}>
            <Text>{label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {tab === "cli" ? <CliPane onError={setError} /> : null}
      {tab === "terminal" && deviceId ? <TerminalPane deviceId={deviceId} onError={setError} /> : null}
      {tab === "files" ? <FilesPane onError={setError} /> : null}
      {tab === "board" && deviceId ? (
        <RenamePane
          deviceId={deviceId}
          name={board}
          onNamed={setBoard}
          onError={setError}
        />
      ) : null}
    </View>
  );
}

function TerminalPane({ deviceId, onError }: { deviceId: string; onError: (msg: string | null) => void }) {
  const [log, setLog] = useState("");
  const [line, setLine] = useState("");
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;
    api()
      .terminalTicket(deviceId)
      .then((ticket) => {
        if (cancelled) return;
        ws = new WebSocket(ticket.ws_url);
        socket.current = ws;
        ws.onmessage = (ev) => {
          const text = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
          setLog((prev) => (prev + text).slice(-8000));
        };
      })
      .catch((err: unknown) => onError(err instanceof Error ? err.message : "Terminal unavailable"));
    return () => {
      cancelled = true;
      ws?.close();
    };
  }, [deviceId, onError]);

  return (
    <View style={{ gap: 8 }}>
      <Text selectable>{log || "Connecting…"}</Text>
      <TextInput
        value={line}
        onChangeText={setLine}
        autoCapitalize="none"
        placeholder="Command"
        onSubmitEditing={() => {
          socket.current?.send(JSON.stringify({ type: "input", data: line + "\n" }));
          setLine("");
        }}
      />
    </View>
  );
}

function CliPane({ onError }: { onError: (msg: string | null) => void }) {
  const [command, setCommand] = useState("");
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    const text = command.trim();
    if (!text || busy) return;
    setBusy(true);
    onError(null);
    try {
      const result = await api().runCli(text);
      const out = [`$ ${result.command}`, result.stdout, result.stderr, result.timed_out ? "timed out" : `exit ${result.exit_code}`]
        .filter(Boolean)
        .join("\n");
      setLog((prev) => (prev ? `${prev}\n\n${out}` : out));
      setCommand("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "CLI failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.pane}>
      <ScrollView style={styles.log}>
        <Text style={styles.mono}>{log || "Commands run on the board."}</Text>
      </ScrollView>
      <TextInput style={styles.input} value={command} onChangeText={setCommand} placeholder="Command" />
      <Pressable style={styles.send} onPress={() => void run()} disabled={busy}>
        <Text style={styles.sendText}>{busy ? "Running" : "Run"}</Text>
      </Pressable>
    </View>
  );
}

function FilesPane({ onError }: { onError: (msg: string | null) => void }) {
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<Array<{ name: string; kind: string }>>([]);
  const [path, setPath] = useState("");
  const [draft, setDraft] = useState("");

  async function load(next: string) {
    onError(null);
    try {
      const listing = await api().listFiles(next);
      setDir(listing.path);
      setEntries(listing.entries);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Files unavailable");
    }
  }

  useEffect(() => {
    void load("");
  }, []);

  async function open(name: string, kind: string) {
    const next = dir ? `${dir}/${name}` : name;
    if (kind === "dir") {
      await load(next);
      return;
    }
    const file = await api().readFile(next);
    setPath(file.path);
    setDraft(file.content);
  }

  async function save() {
    if (!path) return;
    await api().writeFile(path, draft);
    await load(dir);
  }

  return (
    <View style={styles.pane}>
      <Text style={styles.meta}>{dir || "/"}</Text>
      {dir ? (
        <Pressable onPress={() => void load(dir.split("/").slice(0, -1).join("/"))}>
          <Text style={styles.link}>Up</Text>
        </Pressable>
      ) : null}
      <ScrollView style={styles.log}>
        {entries.map((entry) => (
          <Pressable key={entry.name} onPress={() => void open(entry.name, entry.kind)}>
            <Text style={styles.file}>{entry.kind === "dir" ? `${entry.name}/` : entry.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <TextInput style={styles.input} value={path} onChangeText={setPath} placeholder="path/to/file.txt" />
      <TextInput style={[styles.input, styles.editor]} value={draft} onChangeText={setDraft} multiline />
      <Pressable style={styles.send} onPress={() => void save()}>
        <Text style={styles.sendText}>Save</Text>
      </Pressable>
    </View>
  );
}

function RenamePane({
  deviceId,
  name,
  onNamed,
  onError,
}: {
  deviceId: string;
  name: string;
  onNamed: (name: string) => void;
  onError: (msg: string | null) => void;
}) {
  const [draft, setDraft] = useState(name);

  async function save() {
    const clean = draft.trim();
    if (!clean) return;
    onError(null);
    try {
      const res = await api().renameBoard(deviceId, clean);
      onNamed(res.name);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Rename failed");
    }
  }

  return (
    <View style={styles.pane}>
      <Text style={styles.meta}>This name is the board. Each chat keeps its own title.</Text>
      <TextInput style={styles.input} value={draft} onChangeText={setDraft} />
      <Pressable style={styles.send} onPress={() => void save()}>
        <Text style={styles.sendText}>Rename board</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#F5F2EB", paddingTop: 54, paddingHorizontal: 16 },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  title: { fontSize: 20, fontFamily: "Georgia", flex: 1 },
  link: { color: "#78716c" },
  tabs: { flexDirection: "row", gap: 8, marginVertical: 12 },
  tab: { paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: "#E7E0D4", borderRadius: 8 },
  tabOn: { paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: "#1c1917", borderRadius: 8 },
  pane: { flex: 1, gap: 8, paddingBottom: 16 },
  log: { flex: 1 },
  mono: { fontFamily: "Courier", fontSize: 13 },
  file: { paddingVertical: 8, fontSize: 15 },
  meta: { color: "#78716c", fontSize: 12 },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E7E0D4",
    borderRadius: 12,
    padding: 12,
  },
  editor: { minHeight: 120, textAlignVertical: "top" },
  send: { backgroundColor: "#1c1917", borderRadius: 999, paddingVertical: 12, alignItems: "center" },
  sendText: { color: "#fff", fontWeight: "600" },
  error: { color: "#991b1b", marginBottom: 8 },
});
