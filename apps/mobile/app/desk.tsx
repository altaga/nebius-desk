import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api, persistToken, setActiveBoard } from "@/lib/api";
import { Mark } from "@/ui/Mark";

type Msg = { role: string; content: string; meta?: Record<string, unknown> };

export default function DeskScreen() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [badge, setBadge] = useState("Jetson Optimizer standby");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => {
    api()
      .listDevices()
      .then((rows) => {
        if (rows[0]) setActiveBoard(rows[0].id);
      })
      .catch(() => setActiveBoard(null));
  }, []);

  async function pair() {
    const clean = code.trim();
    if (!clean) return;
    try {
      const board = await api().claimPair(clean);
      setActiveBoard(board.id);
      setCode("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pairing failed");
    }
  }

  async function send() {
    const content = input.trim();
    if (!content || loading) return;
    setLoading(true);
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content }]);
    try {
      const res = await api().sendMessage(content, sessionId);
      setSessionId(res.session_id);
      setBadge(res.telemetry.badge);
      const assistant = res.messages.find((x) => x.role === "assistant");
      if (assistant) setMessages((m) => [...m, assistant]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await persistToken(null);
    router.replace("/login");
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <View style={styles.brandRow}>
          <View style={styles.plate}>
            <Mark size={18} />
          </View>
          <Text style={styles.brand}>NebiusDesk</Text>
        </View>
        <Pressable onPress={() => router.push("/machine")}>
          <Text style={styles.logout}>Machine</Text>
        </Pressable>
        <Pressable onPress={() => void logout()}>
          <Text style={styles.logout}>Sign out</Text>
        </Pressable>
      </View>
      <Text style={styles.badge} numberOfLines={2}>
        {badge}
      </Text>
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={setCode}
          autoCapitalize="characters"
          placeholder="Pair code"
        />
        <Pressable style={styles.send} onPress={() => void pair()}>
          <Text style={styles.sendText}>Pair</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.thread} contentContainerStyle={{ gap: 12, paddingBottom: 20 }}>
        {messages.map((m, i) => (
          <View key={i} style={m.role === "user" ? styles.user : styles.assistant}>
            <Text style={styles.role}>{m.role}</Text>
            <Text style={m.role === "assistant" ? styles.serif : undefined}>{m.content}</Text>
          </View>
        ))}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          multiline
          value={input}
          onChangeText={setInput}
          placeholder="Message NebiusDesk…"
        />
        <Pressable
          style={[styles.send, (!input.trim() || loading) && styles.disabled]}
          disabled={!input.trim() || loading}
          onPress={() => void send()}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>Send</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#F5F2EB", paddingTop: 54 },
  top: {
    paddingHorizontal: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  plate: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: "#111312",
    alignItems: "center",
    justifyContent: "center",
  },
  brand: { fontSize: 24, fontFamily: "Georgia" },
  logout: { color: "#78716c" },
  badge: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#FFEDD5",
    color: "#C2410C",
    overflow: "hidden",
    fontSize: 12,
  },
  thread: { flex: 1, paddingHorizontal: 16 },
  user: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E7E0D4",
    borderRadius: 12,
    padding: 12,
  },
  assistant: { padding: 4 },
  role: {
    fontSize: 11,
    color: "#78716c",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  serif: { fontFamily: "Georgia", fontSize: 16, lineHeight: 24 },
  composer: {
    borderTopWidth: 1,
    borderTopColor: "#E7E0D4",
    padding: 12,
    gap: 8,
  },
  input: {
    minHeight: 64,
    maxHeight: 120,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E7E0D4",
    borderRadius: 12,
    padding: 12,
  },
  send: {
    backgroundColor: "#1c1917",
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
  },
  sendText: { color: "#fff", fontWeight: "600" },
  disabled: { opacity: 0.45 },
  error: { color: "#991b1b" },
});
