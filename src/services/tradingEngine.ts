import { AppConfig } from '../types';
import { riskManagement } from '../quant/riskManagement';

export const tradingEngine = {
  // Check if trading is allowed based on risk config
  isTradingAllowed: (config: AppConfig, currentOpenTrades: number, equity: number) => {
    if (!config.general.autoExecution) return { allowed: false, reason: 'Auto-execution disabled' };
    if (currentOpenTrades >= config.risk.maxOpenTrades) return { allowed: false, reason: 'Max open trades reached' };
    
    // Example: Equity protection check
    if (equity < config.risk.equityProtection * 1000) return { allowed: false, reason: 'Equity below protection level' };
    
    return { allowed: true, reason: 'Trading allowed' };
  },

  // Calculate position size based on config
  calculatePositionSize: (config: AppConfig, equity: number) => {
    return (equity * config.risk.maxAllocation) / 100;
  }
};
