
import { EconomicEvent } from '../types';

export const getIncomingHighImpactEvents = async (blockMedium: boolean = false): Promise<EconomicEvent[]> => {
    try {
        const url = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
        
        const response = await fetch(proxyUrl);
        
        if (!response.ok) return [];
        
        const parsed = await response.json();
        
        if (!Array.isArray(parsed)) return [];

        const events: EconomicEvent[] = [];
        const now = Date.now();
        
        for (const item of parsed) {
            if (item.impact === 'High' || (blockMedium && item.impact === 'Medium')) {
                const eventTime = new Date(item.date).getTime();
                // Only consider events from 24h ago to 7 days ahead
                if (eventTime > now - (24 * 60 * 60 * 1000) && eventTime < now + (7 * 24 * 60 * 60 * 1000)) {
                    events.push({
                        id: item.id || Math.random().toString(),
                        name: item.title,
                        impact: item.impact.toUpperCase() as 'HIGH' | 'MEDIUM' | 'LOW',
                        currency: item.country,
                        timestamp: eventTime
                    });
                }
            }
        }
        return events;
    } catch (e) {
        console.error("Failed to fetch news", e);
        return [];
    }
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
        // We already filtered by impact in getIncomingHighImpactEvents, but just in case
        if (event.impact !== 'HIGH' && event.impact !== 'MEDIUM') continue;
        
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
