export interface SessionState {
  sourcePlaylistId: string | null;
  pinnedIds: string[];
}

export interface LastSession extends SessionState {
  alsoRemoveFromSource: boolean;
  currentTrackUri: string | null;
  // Fallback when the track itself is gone (e.g. it was removed from the
  // source playlist on the way out): whatever slid into its old position.
  currentIndex: number;
}

export interface Setup extends SessionState {
  // Missing on setups saved before this was tracked; loading one of those
  // leaves the checkbox as it is.
  alsoRemoveFromSource?: boolean;
  id: string;
  title: string;
  savedAt: number;
}

const SETUPS_KEY = "subgenre_helper.setups";
const LAST_SESSION_KEY = "subgenre_helper.last_session";

// Storage can be unavailable (private mode, blocked site data) or hold
// something malformed from an older version — fall back rather than crash.
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function loadSetups(): Setup[] {
  const setups = read<Setup[]>(SETUPS_KEY, []);
  return Array.isArray(setups) ? setups : [];
}

export function saveSetups(setups: Setup[]) {
  write(SETUPS_KEY, setups);
}

export function loadLastSession(): LastSession {
  const s = read<Partial<LastSession>>(LAST_SESSION_KEY, {});
  return {
    sourcePlaylistId: typeof s.sourcePlaylistId === "string" ? s.sourcePlaylistId : null,
    pinnedIds: Array.isArray(s.pinnedIds) ? s.pinnedIds : [],
    alsoRemoveFromSource: s.alsoRemoveFromSource === true,
    currentTrackUri: typeof s.currentTrackUri === "string" ? s.currentTrackUri : null,
    currentIndex: typeof s.currentIndex === "number" && s.currentIndex >= 0 ? s.currentIndex : 0,
  };
}

export function saveLastSession(state: LastSession) {
  write(LAST_SESSION_KEY, state);
}
