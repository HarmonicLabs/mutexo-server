// 1 rest api call every 30 seconds x IP

import RedisStore from "rate-limit-redis";
import { getRedisClient } from "../redis/getRedisClient";
import { rateLimit } from "express-rate-limit";

// 1 call every 30 seconds
// only used for `/wsAuth`
export const wsAuthIpRateLimit = rateLimit({
    windowMs: 30_000,
    limit: 1,
    store: new RedisStore({
        sendCommand: async (...args: string[]) => {
            const redis = getRedisClient();
            return redis.sendCommand( args );
        },
        prefix: "mutexo:ws_ip_rl:"
    }),
    legacyHeaders: false,
    standardHeaders: "draft-7"
});