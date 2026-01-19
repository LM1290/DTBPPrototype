import { createClient } from '@supabase/supabase-js';
import { Trade, AccountSettings } from '../types';

// Hardcoded credentials for the prototype
const supabaseUrl = 'https://zhvamtwqhwkhieumpfjs.supabase.co';
const supabaseAnonKey = 'sb_publishable_sGdjJ3oB4S31G52RMqwhKw_J9WnR0Q-';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const db = {
  // --- AUTHENTICATION ---
  async signUp(email: string, pass: string) {
    return await supabase.auth.signUp({ email, password: pass });
  },

  async signIn(email: string, pass: string) {
    return await supabase.auth.signInWithPassword({ email, password: pass });
  },

  async signOut() {
    await supabase.auth.signOut();
  },

  // --- TRADES MANAGEMENT ---
  async saveTrades(trades: Trade[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Map user_id to trades and ensure we use 'id' as the conflict target
    const tradesWithUser = trades.map(t => ({
      ...t,
      user_id: user.id
    }));

    const { error } = await supabase
      .from('trades')
      .upsert(tradesWithUser, { onConflict: 'id' });

    if (error) console.error('Supabase Save Error:', error.message);
  },

  async loadTrades(): Promise<Trade[]> {
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .order('timestamp', { ascending: true });

    if (error) {
      console.error('Supabase Load Error:', error.message);
      return [];
    }
    return data || [];
  },

  async deleteTrade(id: string) {
    const { error } = await supabase
      .from('trades')
      .delete()
      .eq('id', id);
    if (error) console.error('Supabase Delete Error:', error.message);
  },

  // --- SETTINGS PERSISTENCE ---
  async saveSettings(settings: AccountSettings) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase
      .from('user_settings')
      .upsert({
        user_id: user.id,
        ...settings
      }, { onConflict: 'user_id' });

    if (error) console.error('Settings Save Error:', error.message);
  },

  async loadSettings(): Promise<AccountSettings | null> {
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .single();

    if (error && error.code !== 'PGRST116') { // Ignore "no rows found" error
      console.error('Settings Load Error:', error.message);
      return null;
    }
    return data;
  }
};
