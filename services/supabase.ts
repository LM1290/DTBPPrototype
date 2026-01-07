import { createClient } from '@supabase/supabase-js';
import { Trade } from '../types';

// Replace with your actual credentials
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'YOUR_SUPABASE_URL';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const db = {
  async saveTrades(trades: Trade[]) {
    if (supabaseUrl === 'YOUR_SUPABASE_URL') return;
    const { error } = await supabase
      .from('trades')
      .upsert(trades, { onConflict: 'id' });
    if (error) console.error('Supabase Save Error:', error);
  },

  async loadTrades(): Promise<Trade[]> {
    if (supabaseUrl === 'YOUR_SUPABASE_URL') return [];
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .order('timestamp', { ascending: true });
    
    if (error) {
      console.error('Supabase Load Error:', error);
      return [];
    }
    return data || [];
  },

  async deleteTrade(id: string) {
    if (supabaseUrl === 'YOUR_SUPABASE_URL') return;
    const { error } = await supabase.from('trades').delete().eq('id', id);
    if (error) console.error('Supabase Delete Error:', error);
  }
};
