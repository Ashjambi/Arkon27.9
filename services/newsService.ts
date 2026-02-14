
import { EconomicEvent } from '../types';

/**
 * في بيئة الإنتاج، يتم جلب هذه البيانات من APIs مثل TradingView أو ForexFactory.
 * هنا نقوم بتوليد أحداث ديناميكية بناءً على التاريخ الحالي لضمان عمل "الدرع الواقي".
 */
const getDynamicEvents = (): EconomicEvent[] => {
    const now = new Date();
    const today = now.getTime();
    
    return [
        { 
            id: 'fed-1', 
            name: 'FED Interest Rate Decision', 
            impact: 'HIGH', 
            currency: 'USD', 
            timestamp: today + (35 * 60 * 1000) // بعد 35 دقيقة من الآن (يفعل الدرع)
        },
        { 
            id: 'cpi-1', 
            name: 'US Core CPI m/m', 
            impact: 'HIGH', 
            currency: 'USD', 
            timestamp: today - (15 * 60 * 1000) // منذ 15 دقيقة (في فترة التبريد)
        },
        { 
            id: 'nfp-1', 
            name: 'Non-Farm Employment Change', 
            impact: 'HIGH', 
            currency: 'USD', 
            timestamp: today + (24 * 60 * 60 * 1000) // غداً
        }
    ];
};

export const getIncomingHighImpactEvents = async (): Promise<EconomicEvent[]> => {
    // محاكاة تأخير الشبكة
    await new Promise(resolve => setTimeout(resolve, 500));
    return getDynamicEvents();
};

export const checkNewsImpactStatus = (events: EconomicEvent[], bypassMins: number, cooldownMins: number) => {
    const now = Date.now();
    const bypassMs = bypassMins * 60 * 1000;
    const cooldownMs = cooldownMins * 60 * 1000;

    // البحث عن حدث قريب (قبل أو بعد)
    const activeEvent = events.find(e => {
        const diff = e.timestamp - now;
        
        // فترة الحظر قبل الخبر (Bypass)
        if (diff > 0 && diff <= bypassMs) return true;
        
        // فترة التبريد بعد الخبر (Cooldown)
        if (diff < 0 && Math.abs(diff) <= cooldownMs) return true;
        
        return false;
    });

    return {
        isPaused: !!activeEvent,
        event: activeEvent,
        reason: activeEvent ? (activeEvent.timestamp > now ? 'PRE_EVENT_LOCK' : 'POST_EVENT_COOLDOWN') : 'NORMAL'
    };
};
