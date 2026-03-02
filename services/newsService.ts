
import { EconomicEvent } from '../types';

export const getIncomingHighImpactEvents = async (): Promise<EconomicEvent[]> => {
    try {
        // Fetch real economic calendar data from ForexFactory via a CORS proxy
        const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent('https://nfs.faireconomy.media/ff_calendar_thisweek.xml')}`);
        
        if (!response.ok) return [];
        
        const data = await response.json();
        const xmlText = data.contents;
        
        // Parse XML
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");
        const events = xmlDoc.getElementsByTagName("event");
        
        const parsedEvents: EconomicEvent[] = [];
        const now = Date.now();
        
        for (let i = 0; i < events.length; i++) {
            const event = events[i];
            const impact = event.getElementsByTagName("impact")[0]?.textContent;
            
            // We only care about High impact news for the trading pause
            if (impact !== 'High') continue;
            
            const title = event.getElementsByTagName("title")[0]?.textContent || 'News Event';
            const country = event.getElementsByTagName("country")[0]?.textContent || 'USD';
            const dateStr = event.getElementsByTagName("date")[0]?.textContent; // e.g. "02-28-2026"
            const timeStr = event.getElementsByTagName("time")[0]?.textContent; // e.g. "8:30am"
            
            if (dateStr && timeStr && !timeStr.includes('All Day') && !timeStr.includes('Tentative')) {
                // ForexFactory times are usually in EST/EDT. 
                // Format: MM/DD/YYYY HH:MM AM EST
                const formattedDate = dateStr.replace(/-/g, '/');
                const dateObj = new Date(`${formattedDate} ${timeStr} EST`);
                
                if (!isNaN(dateObj.getTime())) {
                    // Only keep events from the last 24 hours and future events
                    if (dateObj.getTime() > now - (24 * 60 * 60 * 1000)) {
                        parsedEvents.push({
                            id: `ff-${i}-${dateObj.getTime()}`,
                            name: title,
                            impact: 'HIGH',
                            currency: country,
                            timestamp: dateObj.getTime()
                        });
                    }
                }
            }
        }
        
        return parsedEvents;
    } catch (e) {
        console.error("Failed to fetch real news data:", e);
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
    
    // Sort events by closest time
    const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

    for (const event of sortedEvents) {
        if (event.impact !== 'HIGH') continue;
        
        const timeToEvent = event.timestamp - now;
        
        // 1. Pre-event pause window (Bypass Window)
        if (timeToEvent > 0 && timeToEvent <= bypassMs) {
            return { 
                isPaused: true, 
                event, 
                reason: 'PRE_EVENT', 
                remainingMs: timeToEvent 
            };
        }
        
        // 2. Post-event cooldown window
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
