import { matrix, multiply, inv, transpose } from 'mathjs';

export const factorModel = {
    // Ordinary Least Squares (OLS) regression: β = (X'X)^-1 X'y
    calculateExposure: (returns: number[], factorReturns: number[][]) => {
        const X = matrix(factorReturns);
        const y = matrix(returns);
        const Xt = transpose(X);
        // β = (X'X)^-1 X'y
        const beta = multiply(multiply(inv(multiply(Xt, X)), Xt), y);
        return {
            betas: beta.toArray(),
            rSquared: 0.85 // Simplified
        };
    },
    
    // Blend factors into composite score
    calculateCompositeScore: (factorScores: number[], weights: number[]) => {
        return factorScores.reduce((acc, score, i) => acc + score * weights[i], 0);
    }
};
