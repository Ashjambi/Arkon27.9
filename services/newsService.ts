
import { EconomicEvent } from '../types';

/**
 * استخدام مرجع زمني مستمر عبر تحديثات الصفحة لمنع "تصفير" العدادات.
 */
const getPersistentSessionStart = (): number => {
    const key = 'arkon_news_session_v1';
    const saved = localStorage.getItem(key);
    if (saved) return parseInt(saved);
    
    const now = Date.now();
    localStorage.setItem(key, now.toString());
    return now;
};

const SESSION_START = getPersistentSessionStart();

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
    const bypassMs = bypassMins * 60000;
    const cooldownMs = cooldownMins * 60000;
    
    // ترتيب الأحداث حسب الأقرب زمنياً
    const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

    for (const event of sortedEvents) {
        if (event.impact !== 'HIGH') continue;
        
        const timeToEvent = event.timestamp - now;
        
        // 1. فحص الحظر قبل الخبر (Bypass Window)
        if (timeToEvent > 0 && timeToEvent <= bypassMs) {
            return { 
                isPaused: true, 
                event, 
                reason: 'PRE_EVENT', 
                remainingMs: timeToEvent 
            };
        }
        
        // 2. فحص فترة التبريد بعد الخبر (Cooldown Window)
        // إذا كان الوقت الحالي بعد الخبر ولكن ضمن فترة التبريد
        if (timeToEvent <= 0 && Math.abs(timeToEvent) <= cooldownMs) {
            const cooldownRemaining = cooldownMs - Math.abs(timeToEvent);
            return { 
                isPaused: true, 
                event, 
                reason: 'POST_EVENT', 
                remainingMs: cooldownRemaining 
            };
        }
    }
    
    return { isPaused: false, reason: 'NORMAL', remainingMs: 0 };
};
