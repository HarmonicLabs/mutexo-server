import { rateLimit } from "express-rate-limit";

// 2 calls every 30 seconds
// only used for `/wsAuth`
export const wsAuthIpRateLimit = rateLimit({
    windowMs: 30_000,
    limit: 2,
    legacyHeaders: false,
    standardHeaders: "draft-7"
});