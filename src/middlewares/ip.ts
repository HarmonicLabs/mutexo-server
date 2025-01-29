import { rateLimit } from "express-rate-limit";
import { Request, Response, NextFunction } from "express";

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
    windowMs: 30_000,
    max: 100,
    legacyHeaders: false,
    standardHeaders: "draft-7"
});

// ensure json body
export function ensureJson( req: Request, res: Response, next: NextFunction )
{
    if( req.headers["content-type"] !== "application/json" )
    {
        res
        .status(400)
        .send({
            err: "application/json content-type expected"
        });
        return;
    }
    else next();
};