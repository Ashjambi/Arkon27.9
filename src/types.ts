export interface AppConfig {
  general: {
    autoExecution: boolean;
    hunterMode: boolean;
    qualityThreshold: number;
    cooldownHours: number;
  };
  risk: {
    maxAllocation: number;
    maxOpenTrades: number;
    equityProtection: number;
    riskRewardRatio: number;
  };
  profit: {
    secureThreshold: number;
    partialClosePercent: number;
    trailingStopActivation: number;
    trailingStopStep: number;
  };
  telegram: {
    botToken: string;
    chatId: string;
  };
  news: {
    bypassMinutes: number;
    cooldownMinutes: number;
  };
}

export const defaultConfig: AppConfig = {
  general: { autoExecution: false, hunterMode: true, qualityThreshold: 70, cooldownHours: 24 },
  risk: { maxAllocation: 5, maxOpenTrades: 3, equityProtection: 10, riskRewardRatio: 2 },
  profit: { secureThreshold: 1, partialClosePercent: 50, trailingStopActivation: 0.5, trailingStopStep: 0.1 },
  telegram: { botToken: '', chatId: '' },
  news: { bypassMinutes: 30, cooldownMinutes: 60 },
};
