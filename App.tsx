import React, { useState, useEffect } from 'react';
import { Trade, CalculationResult, DEFAULT_SETTINGS } from './types';
import { calculateBuyingPower } from './services/engine';
import { db, supabase } from './services/supabase';
import { Dashboard } from './components/Dashboard';
import { TradeForm } from './components/TradeForm';
import { ShieldCheck, LogIn, UserPlus, LogOut, Clock, Calendar } from 'lucide-react';

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  const [trades, setTrades] = useState<Trade[]>([]);
  const [calculationResult, setCalculationResult] = useState<CalculationResult>(
    calculateBuyingPower(DEFAULT_SETTINGS, [])
  );

  // Auth Listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load User Data
  useEffect(() => {
    if (session) {
      db.loadTrades().then(data => setTrades(data));
    }
  }, [session]);

  // Recalculate and Sync
  useEffect(() => {
    if (session) {
      setCalculationResult(calculateBuyingPower(DEFAULT_SETTINGS, trades));
      db.saveTrades(trades);
    }
  }, [trades, session]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = authMode === 'signup' 
      ? await db.signUp(email, password) 
      : await db.signIn(email, password);
    if (error) alert(error.message);
  };

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800 w-full max-w-md">
          <h2 className="text-2xl font-bold text-white mb-6 text-center">
            {authMode === 'signup' ? 'Create Account' : 'Sign In to True DTBP'}
          </h2>
          <form onSubmit={handleAuth} className="space-y-4">
            <input type="email" placeholder="Email" className="w-full bg-slate-800 p-3 rounded text-white border border-slate-700" 
              onChange={e => setEmail(e.target.value)} required />
            <input type="password" placeholder="Password" className="w-full bg-slate-800 p-3 rounded text-white border border-slate-700" 
              onChange={e => setPassword(e.target.value)} required />
            <button className="w-full bg-blue-600 py-3 rounded font-bold text-white hover:bg-blue-500 transition-colors">
              {authMode === 'signup' ? 'Sign Up' : 'Sign In'}
            </button>
          </form>
          <button onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')} className="w-full text-slate-500 text-sm mt-4 hover:text-white">
            {authMode === 'signin' ? 'Need an account? Sign Up' : 'Have an account? Sign In'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <header className="bg-slate-900 border-b border-slate-800 p-4 flex justify-between items-center">
        <div className="flex items-center gap-2"><ShieldCheck className="text-blue-500" /><h1 className="font-bold">True DTBP</h1></div>
        <button onClick={() => db.signOut()} className="text-slate-400 hover:text-rose-400 flex items-center gap-1 text-sm"><LogOut size={16} /> Logout</button>
      </header>
      
      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        <TradeForm onAddTrade={(t) => setTrades([...trades, t])} onPreview={() => {}} />
        
        {/* Dashboard now receives date/time formatted trades */}
        <Dashboard data={calculationResult} trades={trades} onDeleteTrade={(id) => setTrades(trades.filter(t => t.id !== id))} />
        
        {/* Restored Audit Trail */}
        <div className="bg-black/40 p-4 rounded-xl border border-slate-800 h-48 overflow-y-auto">
          <h3 className="text-xs font-bold text-slate-600 uppercase mb-2">Math Audit Trail</h3>
          <div className="space-y-1 font-mono text-[11px] text-slate-500">
            {calculationResult.auditLog.map((log, i) => <div key={i}>{log}</div>)}
          </div>
        </div>
      </main>
    </div>
  );
}
