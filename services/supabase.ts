import { createClient, Session } from "@supabase/supabase-js";
import { AccountSettings, Trade } from "../types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isCloudConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = isCloudConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export interface CloudState {
  settings: AccountSettings;
  trades: Trade[];
  updatedAt: string;
}

const requireClient = () => {
  if (!supabase) throw new Error("Cloud sync is not configured.");
  return supabase;
};

const requireUser = async () => {
  const client = requireClient();
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in before syncing.");
  return data.user;
};

export const cloud = {
  async getSession(): Promise<Session | null> {
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  onAuthChange(callback: (session: Session | null) => void) {
    if (!supabase) return () => undefined;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
    return () => data.subscription.unsubscribe();
  },

  async signUp(email: string, password: string) {
    const client = requireClient();
    const { error } = await client.auth.signUp({ email, password });
    if (error) throw error;
  },

  async signIn(email: string, password: string) {
    const client = requireClient();
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },

  async signOut() {
    const client = requireClient();
    const { error } = await client.auth.signOut();
    if (error) throw error;
  },

  async load(): Promise<CloudState | null> {
    const client = requireClient();
    const user = await requireUser();
    const { data, error } = await client
      .from("account_states")
      .select("settings,trades,updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      settings: data.settings as AccountSettings,
      trades: data.trades as Trade[],
      updatedAt: data.updated_at,
    };
  },

  async save(settings: AccountSettings, trades: Trade[]) {
    const client = requireClient();
    const user = await requireUser();
    const { error } = await client.from("account_states").upsert(
      {
        user_id: user.id,
        settings,
        trades,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw error;
  },
};
