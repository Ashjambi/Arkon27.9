
import { EconomicEvent } from '../types';

/**
 * مرجع زمني ثابت يبدأ عند تشغيل التطبيق.
 */
const SESSION_START = Date.now();

const getDynamicEvents = (): EconomicEvent[] => {
    return [
        { 
            id: 'fed-1', 
            name: 'FED Interest Rate Decision', 
            impact: 'HIGH', 
            currency: 'USD', 
            timestamp: SESSION_START + (35 * 60 * 1000) 
        },
        { 
            id: 'cpi-1', 
            name: 'US Core CPI m/m', 
            impact: 'HIGH', 
            currency: 'USD', 
            timestamp: SESSION_START + (12 * 60 * 1000) 
        },
        { 
            id: 'nfp-1', 
            name: 'Non-Farm Employment Change', 
            impact: 'HIGH', 
            currency: 'USD', 
            timestamp: SESSION_START + (120 * 60 * 1000) 
        }
    ];
};

export const getIncomingHighImpactEvents = async (): Promise<EconomicEvent[]> => {
    return getDynamicEvents();
};

export interface NewsStatus {
    isPaused: boolean;
    event?: EconomicEvent;
    reason: 'NORMAL' | 'PRE_EVENT' | 'POST_EVENT';
    remainingMs: number;
}

export const checkNewsImpactStatus = (
    events: EconomicEvent[], 
    bypassMins: number, 
    cooldownMins: number
): NewsStatus => {
    const now = Date.now();
    
    // ترتيب الأحداث حسب الأقرب زمنياً
    const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

    for (const event of sortedEvents) {
        if (event.impact !== 'HIGH') continue;
        
        const timeDiff = event.timestamp - now;
        const minsDiff = timeDiff / 60000;
        
        // 1. فحص الحظر قبل الخبر (Bypass Window)
        if (minsDiff > 0 && minsDiff <= bypassMins) {
            return { 
                isPaused: true, 
                event, 
                reason: 'PRE_EVENT', 
                remainingMs: timeDiff 
            };
        }
        
        // 2. فحص فترة التبريد بعد الخبر (Cooldown Window)
        if (minsDiff <= 0 && Math.abs(minsDiff) <= cooldownMins) {
            const cooldownEnd = event.timestamp + (cooldownMins * 60000);
            return { 
                isPaused: true, 
                event, 
                reason: 'POST_EVENT', 
                remainingMs: cooldownEnd - now 
            };
        }
    }
    
    return { isPaused: false, reason: 'NORMAL', remainingMs: 0 };
};
