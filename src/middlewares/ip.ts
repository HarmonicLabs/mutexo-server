import { rateLimit } from "express-rate-limit";

// 5 calls every 30 seconds
// only used for `/wsAuth`
export const wsAuthIpRateLimit = rateLimit({
    windowMs: 30_000,
    limit: 5,
    legacyHeaders: false,
    standardHeaders: "draft-7"
});

// for general requests (query addresses followed, resolve utxos, etc.)
export const generalRateLimit = rateLimit({
    windowMs: 60_000,
    max: 60,
    legacyHeaders: false,
    standardHeaders: "draft-7"
});