import { matrix, multiply, inv, transpose } from 'mathjs';

// Factor Model: Analyzes asset exposure to risk factors using multi-factor regression
export const factorModel = {
    // Ordinary Least Squares (OLS) regression: β = (X'X)^-1 X'y
    calculateExposure: (returns: number[], factorReturns: number[][]) => {
        const X = matrix(factorReturns);
        const y = matrix(returns);
        const Xt = transpose(X);
        const beta = multiply(multiply(inv(multiply(Xt, X)), Xt), y);
        return beta.toArray();
    }
};
