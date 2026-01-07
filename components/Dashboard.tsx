import React from 'react';
import { CalculationResult, Trade, InstrumentType } from '../types';
import { Trash2, Calendar, Clock, AlertTriangle } from 'lucide-react';

interface Props {
  data: CalculationResult;
  trades: Trade[];
  onDeleteTrade: (id: string) => void;
}

export const Dashboard: React.FC<Props> = ({ data, trades, onDeleteTrade }) => {
  return (
    <div className="space-y-6">
      {/* KPI Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
           <h3 className="text-slate-400 text-sm uppercase">Stock Buying Power</h3>
           <div className="text-4xl font-bold text-white">${data.stockBP.toLocaleString()}</div>
        </div>
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
           <h3 className="text-slate-400 text-sm uppercase">Option Buying Power</h3>
           <div className="text-4xl font-bold text-white">${data.optionBP.toLocaleString()}</div>
        </div>
      </div>

      {/* Warnings */}
      {data.warnings.length > 0 && (
        <div className="bg-rose-900/20 border border-rose-800 p-4 rounded-lg flex gap-3">
          <AlertTriangle className="text-rose-500" />
          <div className="text-rose-300 text-sm">{data.warnings.join(', ')}</div>
        </div>
      )}

      {/* Execution Tracker Table */}
      <div className="bg-slate-900 rounded-lg overflow-hidden border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-800 text-slate-400 uppercase text-xs">
            <tr>
              <th className="p-3">Execution Time</th>
              <th className="p-3">Symbol</th>
              <th className="p-3 text-right">Qty</th>
              <th className="p-3 text-right">Price</th>
              <th className="p-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {trades.map(trade => {
              const dt = new Date(trade.timestamp);
              return (
                <tr key={trade.id} className="text-slate-300 hover:bg-slate-800/40">
                  <td className="p-3">
                    <div className="flex flex-col">
                      <span className="flex items-center gap-1 text-white">
                        <Calendar size={12} className="text-slate-500" /> {dt.toLocaleDateString()}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        <Clock size={12} /> {dt.toLocaleTimeString()}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 font-bold">{trade.symbol}</td>
                  <td className="p-3 text-right">{trade.quantity}</td>
                  <td className="p-3 text-right">${trade.price.toFixed(2)}</td>
                  <td className="p-3 text-center">
                    <button onClick={() => onDeleteTrade(trade.id)} className="text-slate-500 hover:text-rose-500">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
