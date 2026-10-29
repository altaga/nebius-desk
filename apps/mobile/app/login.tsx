import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { api, persistToken } from "@/lib/api";
import { Mark } from "@/ui/Mark";

export default function LoginScreen() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("changeme");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onLogin() {
    setLoading(true);
    setError(null);
    try {
      const res = await api().login(username, password, totp);
      await persistToken(res.access_token);
      router.replace("/desk");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.brandRow}>
        <View style={styles.plate}>
          <Mark size={28} />
        </View>
        <Text style={styles.brand}>Nebius Desk</Text>
      </View>
      <Text style={styles.sub}>Jetson · 2FA · hybrid tokens</Text>

      <TextInput
        style={styles.input}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        placeholder="Username"
      />
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="Password"
      />
      <TextInput
        style={styles.input}
        value={totp}
        onChangeText={(v) => setTotp(v.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        placeholder="2FA code"
        maxLength={6}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.btn, loading && styles.disabled]}
        disabled={loading}
        onPress={() => void onLogin()}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Enter</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: "#F5F2EB",
    padding: 24,
    justifyContent: "center",
    gap: 12,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 4,
  },
  plate: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#111312",
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    fontSize: 34,
    fontFamily: "Georgia",
  },
  sub: {
    color: "#78716c",
    marginBottom: 18,
  },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E7E0D4",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  btn: {
    marginTop: 8,
    backgroundColor: "#1c1917",
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
  },
  disabled: { opacity: 0.45 },
  btnText: { color: "#fff", fontWeight: "600" },
  error: { color: "#991b1b", fontSize: 13 },
});
