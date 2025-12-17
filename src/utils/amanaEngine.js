/**
 * Amana Scoring Engine v2.0
 * Determines credit limits, markup, and trust growth based on behavior.
 */

// 1. Calculate Initial Score (Onboarding + KYC)
const calculateInitialScore = (testScore, businessData) => {
    let score = testScore || 0; // Psychometric 0-60
    
    // Business Data Bonus (up to 40 points)
    if (businessData) {
        if (businessData.yearsInBusiness >= 2) score += 10;
        if (businessData.hasPhysicalLocation) score += 20; // Verified via upload
        if (businessData.startingCapital === 'high') score += 10;
    }
    
    return Math.min(score, 100);
};

// 2. Determine Credit Limit (Linear Formula)
// Formula: Score * 300 (Capped at 30k)
// Threshold: Score < 40 gets 0 limit.
const determineCreditLimit = (score) => {
    if (score < 40) return 0;
    
    const calculatedLimit = score * 300;
    return Math.min(calculatedLimit, 30000); // Strict Max 30k
};

// 3. Determine Tier from Score
const determineTier = (score) => {
    if (score >= 75) return 'Gold';
    if (score >= 50) return 'Silver';
    return 'Bronze';
};

// 4. Determine Markup Percentage (Tiered)
const determineMarkup = (score) => {
    const tier = determineTier(score);
    
    switch (tier) {
        case 'Gold': return 2.5;   // Best Rate
        case 'Silver': return 3.5; // Standard
        default: return 5.0;       // Base Rate
    }
};

// 5. Calculate Score Growth (Repayment Behavior)
const calculateScoreGrowth = (currentScore, repaymentStats) => {
    let growth = 0;
    
    // Base Growth for Clean Repayment
    growth += 2;
    
    // Streak Bonus
    if (repaymentStats.streak > 3) growth += 1;
    if (repaymentStats.streak > 10) growth += 2;
    
    const newScore = currentScore + growth;
    return Math.min(newScore, 100);
};

module.exports = { 
    calculateInitialScore, 
    determineCreditLimit, 
    determineMarkup,
    determineTier,
    calculateScoreGrowth
};
