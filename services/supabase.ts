import { createClient } from '@supabase/supabase-js';
import { Trade } from '../types';

// Hardcoded credentials as requested
const supabaseUrl = 'https://zhvamtwqhwkhieumpfjs.supabase.co';
const supabaseAnonKey = 'sb_publishable_sGdjJ3oB4S31G52RMqwhKw_J9WnR0Q-'; 

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const db = {
  async signUp(email: string, pass: string) {
    return await supabase.auth.signUp({ email, password: pass });
  },

  async signIn(email: string, pass: string) {
    return await supabase.auth.signInWithPassword({ email, password: pass });
  },

  async signOut() {
    await supabase.auth.signOut();
  },

  async saveTrades(trades: Trade[]) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Map user_id to trades for RLS parity
    const tradesWithUser = trades.map(t => ({ ...t, user_id: user.id }));
    const { error } = await supabase.from('trades').upsert(tradesWithUser);
    if (error) console.error('Cloud Save Error:', error);
  },

  async loadTrades(): Promise<Trade[]> {
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .order('timestamp', { ascending: true });
    
    if (error) {
      console.error('Cloud Load Error:', error);
      return [];
    }
    return data || [];
  },

  async deleteTrade(id: string) {
    await supabase.from('trades').delete().eq('id', id);
  }
};
