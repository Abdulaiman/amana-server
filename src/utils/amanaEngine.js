/**
 * Amana Scoring Engine v2.0
 * Determines credit limits, markup, and trust growth based on behavior.
 */

// 1. Calculate Initial Score (Onboarding + KYC)
const calculateInitialScore = (testScore, businessData) => {
    // 1. PSYCHOMETRIC (Max 40 points)
    // Input testScore is 0-75. Normalize to 40.
    const normalizedTestScore = Math.min((testScore / 75) * 40, 40);

    // 2. BUSINESS MATURITY & STABILITY (Max 35 points)
    let businessScore = 0;
    if (businessData) {
        // Years in Business (Max 15)
        if (businessData.yearsInBusiness >= 5) businessScore += 15;
        else if (businessData.yearsInBusiness >= 2) businessScore += 10;
        else if (businessData.yearsInBusiness >= 1) businessScore += 5;

        // Physical Location (Max 10) - Strong signal of permanence
        if (businessData.hasPhysicalLocation) businessScore += 10;

        // Capital (Max 10) - Capacity buffer
        if (businessData.startingCapital === 'high') businessScore += 10;
        else if (businessData.startingCapital === 'medium') businessScore += 5;
    }

    // 3. KYC / IDENTITY (Max 25 points)
    // If they reach this calculation, they have provided BVN etc.
    // We give a base trust score for providing the data.
    let kycScore = 25; 

    // TOTAL CALCULATION
    const totalScore = normalizedTestScore + businessScore + kycScore;
    
    // Round and Cap at 100
    return Math.min(Math.round(totalScore), 100);
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
    if (score >= 80) return 5.0;
    if (score >= 60) return 8.0;
    if (score >= 40) return 12.0;
    return 15.0;
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
