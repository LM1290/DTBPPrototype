import { calculateBuyingPower } from './engine';
import { DEFAULT_SETTINGS, Side, InstrumentType, Trade } from '../types';

describe('DTBP Invariant Tests', () => {
  test('A 10k SPY trade should subtract exactly 10k from Buying Power', () => {
    const trade: Trade = {
      id: '1',
      symbol: 'SPY',
      price: 100,
      quantity: 100, // $10,000 Notional
      side: Side.BUY,
      instrument: InstrumentType.STOCK,
      timestamp: Date.now(),
      fees: 0
    };

    const result = calculateBuyingPower(DEFAULT_SETTINGS, [trade]);

    // Starting BP (4x 30k) = 120,000
    // Expected Result = 110,000
    expect(result.stockBP).toBe(110000);
  });

  test('Selling should release maintenance requirement but not DTBP capacity', () => {
    const buy: Trade = {
      id: '1', symbol: 'SPY', price: 100, quantity: 100, side: Side.BUY,
      instrument: InstrumentType.STOCK, timestamp: 1000, fees: 0
    };
    const sell: Trade = {
      id: '2', symbol: 'SPY', price: 100, quantity: 100, side: Side.SELL,
      instrument: InstrumentType.STOCK, timestamp: 2000, fees: 0
    };

    const result = calculateBuyingPower(DEFAULT_SETTINGS, [buy, sell]);

    // DTBP capacity used = 10,000 (remains used for the day)
    // Maint Req = 0 (released by sell)
    // stockBP = min(120k - 10k, 30k * 4) = 110k
    expect(result.stockBP).toBe(110000);
  });
});
