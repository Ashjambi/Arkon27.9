
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { TradingSignal, MarketAnalysisState, HistoricalTrade } from "../types";

// FIX: Updated to gemini-3-pro-preview as it is the recommended model for complex reasoning and audit tasks.
const AI_MODEL = "gemini-3-pro-preview"; 
const AI_TIMEOUT_MS = 15000; // Increased to 15 seconds for reliability

export interface AIAnalysisResult {
    decision: "APPROVE" | "REJECT" | "WAIT";
    confidence: number;
    reasoning: string;
}

export const analyzeSignalWithAI = async (
    signal: TradingSignal,
    marketState: MarketAnalysisState,
    history: HistoricalTrade[]
    // Removed apiKey param to comply with guidelines
): Promise<AIAnalysisResult | null> => {
    
    // Ensure API Key is available
    if (!process.env.API_KEY) {
        console.error("API_KEY not found in environment");
        return null;
    }

    const analyzePromise = async (): Promise<AIAnalysisResult | null> => {
        try {
            // Initialize the SDK with the environment variable
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

            // 1. Prepare Learning Context
            const recentTrades = history.slice(0, 5);
            let winRate = 0;
            let learningNote = "History: None.";
            
            if (recentTrades.length > 0) {
                const wins = recentTrades.filter(t => t.outcome === 'WIN').length;
                winRate = (wins / recentTrades.length) * 100;
                learningNote = `WinRate: ${winRate.toFixed(1)}%.`;
                if (winRate < 40) learningNote += " MODE: CONSERVATIVE (Reject marginals).";
            }

            // 2. Macro Context
            const sentiment = marketState.fundingRate > 0.01 ? "Crowded Longs" : 
                              marketState.fundingRate < -0.01 ? "Crowded Shorts" : "Neutral";
            
            const systemPrompt = `
            Role: 'ARKON PRIME' Risk Officer.
            Task: Audit Trade Signal.
            
            CONTEXT:
            ${learningNote}
            Funding: ${marketState.fundingRate.toFixed(4)}% (${sentiment})
            Vol (DVOL): ${marketState.dvol}
            
            SIGNAL:
            ${signal.direction} ${signal.asset} @ ${signal.entry}
            Quality: ${signal.qualityScore}%
            
            RULES:
            1. REJECT if Funding contradicts Signal heavily.
            2. REJECT if Quality < 75 AND Volatility is LOW.
            3. APPROVE if Logic is sound.
            
            Return JSON.
            `;

            const response: GenerateContentResponse = await ai.models.generateContent({
                model: AI_MODEL,
                contents: `Details: ${JSON.stringify(signal.details)}`,
                config: {
                    systemInstruction: systemPrompt,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            decision: { type: Type.STRING, enum: ["APPROVE", "REJECT", "WAIT"] },
                            confidence: { type: Type.NUMBER },
                            reasoning: { type: Type.STRING }
                        },
                        required: ["decision", "confidence", "reasoning"]
                    }
                }
            });

            // FIX: Accessed .text as a property as required by the latest @google/genai guidelines.
            if (response.text) {
                return JSON.parse(response.text) as AIAnalysisResult;
            }
            return null;

        } catch (error) {
            console.error("AI Error:", error);
            return null;
        }
    };

    const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => {
            console.warn("AI Timeout Triggered");
            resolve(null);
        }, AI_TIMEOUT_MS);
    });

    return Promise.race([analyzePromise(), timeoutPromise]);
};
