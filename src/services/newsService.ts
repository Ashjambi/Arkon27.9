export enum NewsStatus {
    NORMAL = 'NORMAL',
    PAUSED = 'PAUSED'
}

export const getIncomingHighImpactEvents = async () => {
    return [];
};

export const checkNewsImpactStatus = (events: any[], bypass: number, cooldown: number): { isPaused: boolean, reason: NewsStatus, remainingMs: number, event: any | null } => {
    return { isPaused: false, reason: NewsStatus.NORMAL, remainingMs: 0, event: null };
};
