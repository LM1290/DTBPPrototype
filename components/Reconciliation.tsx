import React, { useMemo } from 'react';
import { CalculationResult, Trade, InstrumentType } from '../types';

interface Props {
  calculated: CalculationResult;
  trades: Trade[]; // Added trades prop to calculate weekly stats
}

export const Reconciliation: React.FC<Props> = ({ calculated, trades }) => {
  // Excel Parity: WEEKNUM logic
  const getWeekNumber = (date: Date) => {
    const tempDate = new Date(date.getTime());
    tempDate.setHours(0, 0, 0, 0);
    const jan1 = new Date(tempDate.getFullYear(), 0, 1);
    const dayOfYear = (tempDate.getTime() - jan1.getTime()) / 86400000;
    return Math.ceil((dayOfYear + jan1.getDay() + 1) / 7);
  };

  // Aggregate stats by week
  const weeklyStats = useMemo(() => {
    const weeks: Record<number, { premium: number; fees: number; profit: number }> = {};

    trades.forEach(t => {
      const week = getWeekNumber(new Date(t.timestamp));
      if (!weeks[week]) weeks[week] = { premium: 0, fees: 0, profit: 0 };
      
      const multiplier = t.instrument === InstrumentType.OPTION ? 100 : 1;
      const totalValue = t.quantity * t.price * multiplier;
      
      weeks[week].premium += totalValue;
      weeks[week].fees += (t.fees || 0);
      weeks[week].profit += (totalValue - (t.fees || 0));
    });

    return Object.entries(weeks).sort((a, b) => Number(b[0]) - Number(a[0]));
  }, [trades]);

  return (
    <div className="space-y-6">
      <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
        <h3 className="text-xl font-bold text-white mb-4 border-b border-slate-700 pb-2">Broker Reconciliation</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-900 p-4 rounded border border-slate-700">
            <label className="block text-slate-400 text-xs uppercase font-bold mb-2">Calculated Stock BP</label>
            <span className="text-2xl font-mono text-white">${calculated.stockBP.toLocaleString()}</span>
          </div>
          <div className="bg-slate-900 p-4 rounded border border-slate-700">
            <label className="block text-slate-400 text-xs uppercase font-bold mb-2">Calculated Option BP</label>
            <span className="text-2xl font-mono text-white">${calculated.optionBP.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Excel Parity: Weekly Summary Table */}
      <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          Weekly Performance (Excel Parity)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-400">
            <thead className="bg-slate-900 text-xs uppercase font-bold">
              <tr>
                <th className="p-3">Week #</th>
                <th className="p-3 text-right">Tot Premium</th>
                <th className="p-3 text-right">Fees</th>
                <th className="p-3 text-right">Net Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {weeklyStats.length === 0 ? (
                <tr><td colSpan={4} className="p-4 text-center">No weekly data available.</td></tr>
              ) : (
                weeklyStats.map(([week, stats]) => (
                  <tr key={week} className="hover:bg-slate-700/30">
                    <td className="p-3 font-mono text-blue-400">Week {week}</td>
                    <td className="p-3 text-right">${stats.premium.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
                    <td className="p-3 text-right text-rose-400">-${stats.fees.toLocaleString()}</td>
                    <td className={`p-3 text-right font-bold ${stats.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      ${stats.profit.toLocaleString(undefined, {minimumFractionDigits: 2})}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
