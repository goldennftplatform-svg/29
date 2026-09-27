'use strict';

function num(raw, dflt) {
    const n = Number(raw);
    return (!isNaN(n) && isFinite(n) && n > 0) ? n : dflt;
}

const pricing = {
    pointsPerUsd: num(process.env.LITECRIB_POINTS_PER_USD, 10),
    minPvpEntryUsd: num(process.env.LITECRIB_MIN_PVP_ENTRY_USD, 2),
    houseFeeRate: Math.min(num(process.env.LITECRIB_HOUSE_FEE_RATE, 0.005), 0.01),
    maxHouseFeeRate: 0.01,
    pointsPerTestLtc: num(process.env.LITECRIB_POINTS_PER_TEST_LTC, 1000)
};

pricing.minPvpEntryPoints = Math.round(pricing.minPvpEntryUsd * pricing.pointsPerUsd);
pricing.r2 = (n) => Math.round(n * 100) / 100;
pricing.pointsForUsd = (usd) => Math.round((usd || 0) * pricing.pointsPerUsd);
pricing.usdForPoints = (pts) => pricing.r2((pts || 0) / pricing.pointsPerUsd);
pricing.pointsForLtc = (ltc) => Math.round((ltc || 0) * pricing.pointsPerTestLtc);
pricing.feeForPot = (pot) => pricing.r2((pot || 0) * pricing.houseFeeRate);

pricing.public = function () {
    return {
        currency: 'USD',
        pointsPerUsd: pricing.pointsPerUsd,
        minPvpEntryUsd: pricing.minPvpEntryUsd,
        minPvpEntryPoints: pricing.minPvpEntryPoints,
        houseFeeRate: pricing.houseFeeRate,
        maxHouseFeeRate: pricing.maxHouseFeeRate,
        pointsPerTestLtc: pricing.pointsPerTestLtc,
        mode: 'testnet-demo'
    };
};

module.exports = pricing;