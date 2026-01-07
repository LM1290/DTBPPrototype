import React, { useMemo } from 'react';
import { CalculationResult, Trade, InstrumentType } from '../types';
import { AlertTriangle, Info, Trash2, Calendar, Clock } from 'lucide-react';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface Props {
  data: CalculationResult;
  trades: Trade[];
  scenarioData: CalculationResult | null;
  onDeleteTrade: (id: string) => void;
}

export const Dashboard: React.FC<Props> = ({ data, trades, scenarioData, onDeleteTrade }) => {
  const displayData = scenarioData || data;
  const isScenario = !!scenarioData;

  const bpUtilization = useMemo(() => {
    const max = displayData.dtbpStartOfDay;
    const current = displayData.stockBP;
    if (max === 0) return 0;
    return Math.max(0, Math.min(100, (current / max) * 100));
  }, [displayData]);

  const riskColor = displayData.warnings.length > 0 ? 'bg-rose-500' : (bpUtilization < 20 ? 'bg-amber-500' : 'bg-emerald-500');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      
      {/* KPI Cards */}
      <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className={`relative p-6 rounded-xl border ${isScenario ? 'border-amber-500/50 bg-amber-900/10' : 'border-slate-700 bg-slate-800'} overflow-hidden`}>
           {isScenario && <div className="absolute top-2 right-2 text-amber-500 text-xs font-bold uppercase tracking-wider">Scenario Mode</div>}
           <h3 className="text-slate-400 text-sm font-medium uppercase tracking-wider mb-1">Stock Buying Power</h3>
           <div className="text-4xl font-bold text-white tracking-tight">${displayData.stockBP.toLocaleString()}</div>
           <div className="mt-4 h-2 w-full bg-slate-700 rounded-full overflow-hidden">
             <div className={`h-full ${riskColor} transition-all duration-500`} style={{ width: `${bpUtilization}%` }} />
           </div>
        </div>

        <div className={`relative p-6 rounded-xl border ${isScenario ? 'border-amber-500/50 bg-amber-900/10' : 'border-slate-700 bg-slate-800'}`}>
           <h3 className="text-slate-400 text-sm font-medium uppercase tracking-wider mb-1">Option BP (Excess)</h3>
           <div className="text-4xl font-bold text-white tracking-tight">${displayData.optionBP.toLocaleString()}</div>
           <p className="text-xs text-slate-500 mt-2">Available for 100% Margin Instruments</p>
        </div>

        {/* Excel-Parity Alerts: Margin Call Deficits */}
        {displayData.warnings.length > 0 && (
          <div className="sm:col-span-2 bg-rose-900/20 border border-rose-800 rounded-lg p-4 flex items-start gap-3">
             <AlertTriangle className="text-rose-500 shrink-0" />
             <div>
               <h4 className="text-rose-400 font-bold text-sm">Action Required</h4>
               <ul className="text-rose-300 text-sm list-disc list-inside">
                 {displayData.warnings.map((w, i) => <li key={i}>{w}</li>)}
               </ul>
             </div>
          </div>
        )}
      </div>

      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 min-h-[200px]">
        <h4 className="text-slate-400 text-xs uppercase mb-4">Account Composition</h4>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={[
            { name: 'Stock BP', value: displayData.stockBP },
            { name: 'Option BP', value: displayData.optionBP },
            { name: 'Equity', value: displayData.currentEquity }
          ]}>
            <XAxis dataKey="name" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#fff' }} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              <Cell fill="#3b82f6" /><Cell fill="#8b5cf6" /><Cell fill="#10b981" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Trade Ledger: Matches Spreadsheet "Tracker" View */}
      <div className="lg:col-span-3">
        <h3 className="text-white font-bold text-lg mb-4">Execution Tracker</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-400">
            <thead className="bg-slate-800 text-xs uppercase">
              <tr>
                <th className="p-3 rounded-l">Date & Time</th>
                <th className="p-3">Symbol</th>
                <th className="p-3">Side</th>
                <th className="p-3 text-right">Qty/Contracts</th>
                <th className="p-3 text-right">Price</th>
                <th className="p-3 text-right">Tot Premium</th>
                <th className="p-3 text-center rounded-r w-16">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {trades.length === 0 ? (
                <tr><td colSpan={7} className="p-4 text-center text-slate-600">No active trades in ledger.</td></tr>
              ) : (
                [...trades].reverse().map(trade => {
                   const date = new Date(trade.timestamp);
                   const isOption = trade.instrument === InstrumentType.OPTION;
                   // Parity: Options use * 100 multiplier
                   const multiplier = isOption ? 100 : 1;
                   const totalValue = trade.quantity * trade.price * multiplier;
                   
                   return (
                    <tr key={trade.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="p-3">
                        <div className="flex flex-col">
                          <span className="text-white flex items-center gap-1 font-medium">
                            <Calendar size={12} className="text-slate-500" />
                            {date.toLocaleDateString()}
                          </span>
                          <span className="text-xs text-slate-500 flex items-center gap-1">
                            <Clock size={12} />
                            {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="font-bold text-white">{trade.symbol}</span>
                        {isOption && <span className="ml-1 text-[10px] bg-blue-500/20 text-blue-400 px-1 rounded">OPT</span>}
                      </td>
                      <td className={`p-3 font-medium ${trade.side.includes('Buy') ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {trade.side}
                      </td>
                      <td className="p-3 text-right font-mono">{trade.quantity}</td>
                      <td className="p-3 text-right font-mono">${trade.price.toFixed(2)}</td>
                      <td className="p-3 text-right text-slate-300 font-mono">
                        ${totalValue.toLocaleString()}
                      </td>
                      <td className="p-3 text-center">
                        <button onClick={() => onDeleteTrade(trade.id)} className="text-slate-500 hover:text-rose-500 p-1">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
