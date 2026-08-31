import { createClient, type AuthChangeEvent, type Session, type User } from "@supabase/supabase-js";

import { ORACLE_CONFIG } from "./config";
import { isOracleState, normalizeOracleState } from "./storage";
import type { OracleState } from "./types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "";

export const accountServiceConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const supabase = accountServiceConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null;

let activeUser: User | null = null;
let archiveRevision: number | null = null;

interface ArchiveRow {
  state: unknown;
  revision: number;
}

export interface ArchiveSyncResult {
  state: OracleState;
  source: "local" | "remote";
}

export function currentAccountUser(): User | null {
  return activeUser;
}

export async function initializeAccountSession(): Promise<User | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  activeUser = data.session?.user ?? null;
  return activeUser;
}

export function observeAccountSession(
  callback: (event: AuthChangeEvent, session: Session | null) => void,
): () => void {
  if (!supabase) return () => undefined;
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    activeUser = session?.user ?? null;
    if (!activeUser) archiveRevision = null;
    callback(event, session);
  });
  return () => data.subscription.unsubscribe();
}

export async function sendPasswordlessLink(email: string): Promise<void> {
  if (!supabase) throw new Error("Account service is not configured.");
  const redirect = new URL(import.meta.env.BASE_URL, window.location.origin);
  redirect.hash = "account";
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirect.toString(),
      shouldCreateUser: true,
    },
  });
  if (error) throw error;
}

export async function signOutAccount(): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  activeUser = null;
  archiveRevision = null;
}

async function ensureProfile(user: User): Promise<void> {
  if (!supabase) return;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const { error } = await supabase.from("oracle_profiles").upsert({
    id: user.id,
    timezone,
    state_version: 2,
    deck_version: ORACLE_CONFIG.deckVersion,
    algorithm_version: ORACLE_CONFIG.algorithmVersion,
  }, { onConflict: "id" });
  if (error) throw error;
}

async function readArchive(user: User): Promise<ArchiveRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("oracle_archives")
    .select("state, revision")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data as ArchiveRow | null;
}

export async function attachOrRestoreArchive(
  localState: OracleState,
  user = activeUser,
): Promise<ArchiveSyncResult> {
  if (!supabase || !user) return { state: localState, source: "local" };
  await ensureProfile(user);
  const remote = await readArchive(user);

  if (remote) {
    archiveRevision = remote.revision;
    return isOracleState(remote.state)
      ? { state: normalizeOracleState(remote.state), source: "remote" }
      : { state: localState, source: "local" };
  }

  const { data, error } = await supabase
    .from("oracle_archives")
    .insert({ user_id: user.id, state: localState })
    .select("state, revision")
    .single();

  if (error) {
    const racedArchive = await readArchive(user);
    if (racedArchive && isOracleState(racedArchive.state)) {
      archiveRevision = racedArchive.revision;
      return { state: normalizeOracleState(racedArchive.state), source: "remote" };
    }
    throw error;
  }

  const created = data as ArchiveRow;
  archiveRevision = created.revision;
  return { state: localState, source: "local" };
}

export async function syncAccountArchive(
  nextState: OracleState,
  user = activeUser,
): Promise<ArchiveSyncResult> {
  if (!supabase || !user) return { state: nextState, source: "local" };
  if (archiveRevision === null) return attachOrRestoreArchive(nextState, user);

  const expectedRevision = archiveRevision;
  const { data, error } = await supabase
    .from("oracle_archives")
    .update({
      state: nextState,
      revision: expectedRevision + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("revision", expectedRevision)
    .select("state, revision")
    .maybeSingle();

  if (error) throw error;
  if (data) {
    archiveRevision = (data as ArchiveRow).revision;
    return { state: nextState, source: "local" };
  }

  const canonical = await readArchive(user);
  if (canonical && isOracleState(canonical.state)) {
    archiveRevision = canonical.revision;
    return { state: normalizeOracleState(canonical.state), source: "remote" };
  }
  return attachOrRestoreArchive(nextState, user);
}
