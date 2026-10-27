import * as SecureStore from "expo-secure-store";
import { createApiClient } from "@nebius-desk/shared/api";
const TOKEN_KEY = "nebiusdesk_token";

export async function getStoredToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setStoredToken(token: string | null) {
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

function defaultBaseUrl() {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;
  return "https://nebius-desk-cloud.devops-640.workers.dev";
}

let cachedToken: string | null = null;
let boardId: string | null = null;

export function setActiveBoard(id: string | null) {
  boardId = id;
}

export function api() {
  return createApiClient({
    baseUrl: defaultBaseUrl(),
    getToken: () => cachedToken,
    getDeviceId: () => boardId,
  });
}

export async function hydrateToken() {
  cachedToken = await getStoredToken();
  return cachedToken;
}

export async function persistToken(token: string | null) {
  cachedToken = token;
  await setStoredToken(token);
}
