const KEY = "nebiusdesk.place";

export type DeskPlace = { deviceId?: string; sessionId?: string | null };

export function readPlace(): DeskPlace {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) || "{}") as DeskPlace;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writePlace(place: DeskPlace) {
  window.localStorage.setItem(KEY, JSON.stringify(place));
}

export function clearPlace() {
  window.localStorage.removeItem(KEY);
}
