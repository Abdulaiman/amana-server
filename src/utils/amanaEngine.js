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
// Formula: Score * 600 (Capped at 60k)
// Threshold: Score < 40 gets 0 limit.
const determineCreditLimit = (score) => {
    if (score < 40) return 0;
    
    const calculatedLimit = score * 600;
    return Math.min(calculatedLimit, 60000); // Strict Max 60k
};

// 3. Determine Tier from Score
const determineTier = (score) => {
    if (score >= 75) return 'Gold';
    if (score >= 50) return 'Silver';
    return 'Bronze';
};

// 4. Determine Markup Percentage (Term-Based Dynamic)
const determineMarkup = (score, termDays = 14) => {
    let baseMarkup = 15.0;
    
    // 1. Determine Base Markup from Score Tiers
    if (score >= 80) baseMarkup = 5.0;
    else if (score >= 60) baseMarkup = 8.0;
    else if (score >= 40) baseMarkup = 12.0;

    // 2. Apply Term Multiplier
    // 3 Days: 0.5x (50% discount)
    // 7 Days: 0.75x (25% discount)
    // 14 Days: 1.0x (Standard)
    let termMultiplier = 1.0;
    if (termDays <= 3) termMultiplier = 0.5;
    else if (termDays <= 7) termMultiplier = 0.75;

    let calculatedMarkup = baseMarkup * termMultiplier;

    // 3. Enforce 4.0% Minimum Floor
    return Math.max(calculatedMarkup, 4.0);
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
