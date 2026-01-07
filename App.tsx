import React, { useState, useEffect } from 'react';
import { AccountSettings, DEFAULT_SETTINGS, Trade, CalculationResult } from './types';
import { calculateBuyingPower } from './services/engine';
import { db } from './services/supabase';
import { SettingsPanel } from './components/SettingsPanel';
import { TradeForm } from './components/TradeForm';
import { Dashboard } from './components/Dashboard';
import { Reconciliation } from './components/Reconciliation';
import { Settings, ShieldCheck, RefreshCw, RotateCcw } from 'lucide-react';

export default function App() {
  const [settings, setSettings] = useState<AccountSettings>(DEFAULT_SETTINGS);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'reconcile'>('dashboard');
  
  const [calculationResult, setCalculationResult] = useState<CalculationResult>(
    calculateBuyingPower(DEFAULT_SETTINGS, [])
  );
  
  // Scenario/Preview State for "What-If" Analysis
  const [previewTrade, setPreviewTrade] = useState<Trade | null>(null);
  const [scenarioResult, setScenarioResult] = useState<CalculationResult | null>(null);

  // 1. Initial load: Fetch from Supabase Cloud
  useEffect(() => {
    const initData = async () => {
      const savedTrades = await db.loadTrades();
      if (savedTrades.length > 0) {
        setTrades(savedTrades);
      }
    };
    initData();
  }, []);

  // 2. Sync and Recalculate: Run engine on every state change
  useEffect(() => {
    const res = calculateBuyingPower(settings, trades);
    setCalculationResult(res);
    
    // Auto-save to cloud
    if (trades.length > 0) {
      db.saveTrades(trades);
    }
  }, [settings, trades]);

  // 3. Scenario Calculation: Real-time preview while filling the form
  useEffect(() => {
    if (previewTrade) {
      setScenarioResult(calculateBuyingPower(settings, [...trades, previewTrade]));
    } else {
      setScenarioResult(null);
    }
  }, [previewTrade, settings, trades]);

  const handleAddTrade = (trade: Trade) => {
    setTrades(prev => [...prev, trade]);
  };

  const handleDeleteTrade = async (id: string) => {
    setTrades(prev => prev.filter(t => t.id !== id));
    await db.deleteTrade(id); 
  };

  const handleResetSession = async () => {
    if (window.confirm("Clear local state? Cloud data persists unless deleted in DB.")) {
      setTrades([]);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-blue-500/30">
      
      {/* Navigation Header */}
      <header className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-blue-500" />
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
              True DTBP + Option Tracker
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
             <button onClick={handleResetSession} className="text-slate-400 hover:text-rose-400 p-2" title="Reset UI State">
              <RotateCcw size={20} />
            </button>
            <div className="h-6 w-px bg-slate-800"></div>
             <button 
              onClick={() => setActiveTab('reconcile')}
              className={`text-sm font-medium flex items-center gap-2 px-3 py-1.5 rounded transition-colors ${activeTab === 'reconcile' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              <RefreshCw size={16} /> <span className="hidden sm:inline">Weekly Reconciliation</span>
            </button>
            <button 
              onClick={() => setActiveTab('dashboard')}
               className={`text-sm font-medium flex items-center gap-2 px-3 py-1.5 rounded transition-colors ${activeTab === 'dashboard' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Dashboard
            </button>
            <button onClick={() => setIsSettingsOpen(true)} className="text-slate-400 hover:text-white">
              <Settings size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Viewport */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'dashboard' ? (
          <div className="space-y-6">
            <TradeForm onAddTrade={handleAddTrade} onPreview={setPreviewTrade} />
            <Dashboard 
              data={calculationResult} 
              trades={trades} 
              scenarioData={scenarioResult}
              onDeleteTrade={handleDeleteTrade}
            />
          </div>
        ) : (
          <Reconciliation calculated={calculationResult} trades={trades} />
        )}
      </main>

      <SettingsPanel 
        settings={settings} 
        onSave={setSettings} 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
      />

      <footer className="max-w-7xl mx-auto px-4 py-8 text-center border-t border-slate-800 mt-8">
        <p className="text-xs text-slate-600">
          Excel Parity Engine | Cloud Sync Status: {trades.length > 0 ? 'Connected' : 'Standby'}
        </p>
      </footer>
    </div>
  );
}
