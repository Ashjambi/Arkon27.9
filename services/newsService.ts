
import { EconomicEvent } from '../types';

// ملاحظة: في بيئة حقيقية، سيتم جلب هذه البيانات من API مثل TradingView أو ForexFactory
// تم تعطيل الأحداث الوهمية التلقائية لمنع تفعيل الدرع بشكل خاطئ.
// يمكنك إضافة أحداث هنا يدوياً للاختبار بتواريخ محددة.
const MOCK_EVENTS: EconomicEvent[] = [
    // مثال لحدث مستقبلي بعيد (لن يفعل الدرع اليوم)
    { id: '1', name: 'Next FED Meeting', impact: 'HIGH', currency: 'USD', timestamp: new Date('2025-03-20T18:00:00Z').getTime() },
    
    // مثال لحدث قديم (لن يفعل الدرع)
    { id: '2', name: 'Previous CPI Data', impact: 'HIGH', currency: 'USD', timestamp: new Date('2025-01-15T13:30:00Z').getTime() } 
];

export const getIncomingHighImpactEvents = async (): Promise<EconomicEvent[]> => {
    // إرجاع القائمة (التي لا تحتوي حالياً على أحداث قريبة جداً)
    return MOCK_EVENTS.filter(e => e.impact === 'HIGH');
};

export const checkNewsImpactStatus = (events: EconomicEvent[], bypassMins: number, cooldownMins: number) => {
    const now = Date.now();
    const bypassMs = bypassMins * 60 * 1000;
    const cooldownMs = cooldownMins * 60 * 1000;

    const activeEvent = events.find(e => {
        const diff = e.timestamp - now;
        // حالة 1: الخبر يقترب (فترة التوقف قبل) - يجب أن يكون الفرق إيجابياً وأقل من فترة الحظر
        if (diff > 0 && diff <= bypassMs) return true;
        // حالة 2: الخبر حدث للتو (فترة التبريد بعد) - يجب أن يكون الفرق سلبياً (حدث في الماضي) وضمن فترة التبريد
        if (diff < 0 && Math.abs(diff) <= cooldownMs) return true;
        return false;
    });

    return {
        isPaused: !!activeEvent,
        event: activeEvent,
        reason: activeEvent ? (activeEvent.timestamp > now ? 'PRE_EVENT_LOCK' : 'POST_EVENT_COOLDOWN') : 'NORMAL'
    };
};
