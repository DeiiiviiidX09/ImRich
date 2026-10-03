
/*
 * TRADE AI
 * Motor de señales v1.0
 * Solo análisis y simulación.
 * No ejecuta operaciones reales.
 */

const TradeAI = (() => {

  // Configuración inicial
  const CONFIG = {
    emaFast: 20,
    emaSlow: 50,
    rsiPeriod: 14,
    atrPeriod: 14,
    rsiBuyMin: 50,
    rsiBuyMax: 70,
    rsiSellMin: 30,
    rsiSellMax: 50
  };

  // Calcula una media móvil exponencial
  function calculateEMA(prices, period) {
    if (prices.length < period) return null;

    const multiplier = 2 / (period + 1);

    let ema = prices
      .slice(0, period)
      .reduce((sum, price) => sum + price, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  // Calcula el RSI
  function calculateRSI(prices, period = 14) {
    if (prices.length <= period) return null;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];

      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];

      avgGain =
        (avgGain * (period - 1) + Math.max(change, 0)) / period;

      avgLoss =
        (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    }

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;

    return 100 - (100 / (1 + rs));
  }

  // Calcula el ATR a partir de velas OHLC
  function calculateATR(candles, period = 14) {
    if (candles.length <= period) return null;

    const ranges = [];

    for (let i = 1; i < candles.length; i++) {
      const current = candles[i];
      const previous = candles[i - 1];

      const range = Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      );

      ranges.push(range);
    }

    const recent = ranges.slice(-period);

    return recent.reduce((sum, value) => sum + value, 0) / period;
  }

  // Analiza el mercado y devuelve una señal
  function analyze(candles) {
    if (!Array.isArray(candles) || candles.length < 51) {
      return {
        signal: "WAIT",
        reason: "Datos insuficientes"
      };
    }

    const prices = candles.map(candle => candle.close);

    const emaFast = calculateEMA(prices, CONFIG.emaFast);
    const emaSlow = calculateEMA(prices, CONFIG.emaSlow);
    const rsi = calculateRSI(prices, CONFIG.rsiPeriod);
    const atr = calculateATR(candles, CONFIG.atrPeriod);

    const lastCandle = candles[candles.length - 1];

    if (
      emaFast === null ||
      emaSlow === null ||
      rsi === null ||
      atr === null
    ) {
      return {
        signal: "WAIT",
        reason: "No se pudieron calcular los indicadores"
      };
    }

    // Condiciones para compra
    const buy =
      emaFast > emaSlow &&
      rsi > CONFIG.rsiBuyMin &&
      rsi < CONFIG.rsiBuyMax &&
      lastCandle.close > emaFast &&
      lastCandle.close > emaSlow;

    // Condiciones para venta
    const sell =
      emaFast < emaSlow &&
      rsi > CONFIG.rsiSellMin &&
      rsi < CONFIG.rsiSellMax &&
      lastCandle.close < emaFast &&
      lastCandle.close < emaSlow;

    let signal = "WAIT";
    let reason = "No hay una señal clara";

    if (buy) {
      signal = "BUY";
      reason = "Tendencia alcista confirmada";
    } else if (sell) {
      signal = "SELL";
      reason = "Tendencia bajista confirmada";
    }

    return {
      signal,
      reason,
      indicators: {
        emaFast,
        emaSlow,
        rsi,
        atr
      },
      price: lastCandle.close
    };
  }

  return {
    analyze,
    calculateEMA,
    calculateRSI,
    calculateATR
  };

})();
