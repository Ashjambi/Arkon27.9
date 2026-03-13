// Strategy Thesis: Mean Reversion on BTC/ETH Perpetual Markets
// Exploit short-term price overextensions relative to volatility.
// Universe: BTC-PERPETUAL, ETH-PERPETUAL on Deribit.
// Signal: Bollinger Band breach (Price > Upper Band = Sell, Price < Lower Band = Buy).
// Exit: Reversion to Mean (Moving Average).

export const strategyArchitect = {
  thesis: "Mean Reversion on BTC/ETH Perpetual Markets",
  universe: ["BTC-PERPETUAL", "ETH-PERPETUAL"],
  signalLogic: "Bollinger Band breach with reversion to mean",
  riskParameters: {
    maxDrawdown: 0.1, // 10%
    positionLimit: 0.05, // 5% of equity
  }
};
