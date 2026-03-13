export const sendToWebhook = async (signal: any, url: string, allocation: number, action: string, lotSize: number, secret: string) => {
    return { success: true };
};

export const checkBridgeStatus = async (url: string) => {
    return true;
};

export const fetchBridgeState = async (url: string) => {
    return { positions: [] };
};

export const clearRemoteBridge = async (url: string) => {
    return true;
};
