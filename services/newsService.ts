
import { EconomicEvent } from '../types';

/**
 * مرجع زمني ثابت يبدأ عند تشغيل التطبيق.
 * هذا يضمن أن المواعيد الوهمية (Mock Events) تظل ثابتة ولا تتغير مع كل تحديث للبيانات.
 */
const SESSION_START = Date.now();

/**
 * توليد أحداث اقتصادية ثابتة المواعيد بالنسبة لوقت بدء الجلسة.
 */
const getDynamicEvents = (): EconomicEvent[] => {
    return [
        { 
            id: 'fed-1', 
            name: 'FED Interest Rate Decision', 
            impact: 'HIGH', 
            currency: 'USD', 
            timestamp: SESSION_START + (35 * 60 * 1000) // بعد 35 دقيقة ثابتة
        },
        { 
            id: 'cpi-1', 
            name: 'US Core CPI m/m', 
            impact: 'HIGH', 
            currency: 'USD', 
            timestamp: SESSION_START + (12 * 60 * 1000) // بعد 12 دقيقة ثابتة
        },
        { 
            id: 'nfp-1', 
            name: 'Non-Farm Employment Change', 
            impact: 'HIGH', 
            currency: 'USD', 
            timestamp: SESSION_START + (120 * 60 * 1000) // بعد ساعتين
        }
    ];
};

/**
 * جلب الأحداث الاقتصادية القادمة.
 */
export const getIncomingHighImpactEvents = async (): Promise<EconomicEvent[]> => {
    // في بيئة الإنتاج، سيتم استبدال هذا بطلب API حقيقي.
    return getDynamicEvents();
};

/**
 * التحقق مما إذا كان هناك خبر حالي يؤثر على قرار التداول.
 * @param events قائمة الأخبار
 * @param bypassMins عدد الدقائق قبل الخبر لقفل التداول
 * @param cooldownMins عدد الدقائق بعد الخبر لفك القفل
 */
export const checkNewsImpactStatus = (
    events: EconomicEvent[], 
    bypassMins: number, 
    cooldownMins: number
): { isPaused: boolean; event?: EconomicEvent; reason: string } => {
    const now = Date.now();
    
    for (const event of events) {
        if (event.impact !== 'HIGH') continue;
        
        const timeToEvent = event.timestamp - now;
        const minsToEvent = timeToEvent / 60000;
        
        // 1. فحص الحظر قبل الخبر (Bypass Window)
        if (minsToEvent > 0 && minsToEvent <= bypassMins) {
            return { isPaused: true, event, reason: 'PRE_EVENT' };
        }
        
        // 2. فحص فترة التبريد بعد الخبر (Cooldown Window)
        if (minsToEvent < 0 && Math.abs(minsToEvent) <= cooldownMins) {
            return { isPaused: true, event, reason: 'POST_EVENT' };
        }
    }
    
    return { isPaused: false, reason: 'NORMAL' };
};
