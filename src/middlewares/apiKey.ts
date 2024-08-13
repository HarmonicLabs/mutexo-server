import { Request as ExpressReq, Response as ExpressRes, NextFunction } from "express";
import { API_KEY } from "../wsServer/clientProps";
import { getRedisClient } from "../redis/getRedisClient";

export function getApiKey( req: ExpressReq ): API_KEY | undefined
{
    const apiKey = req.headers["X-ChainSync-Key"];
    if( typeof apiKey !== "string" ) return undefined;

    return apiKey;
}

export function validateApiKey( req: ExpressReq, res: ExpressRes, next: NextFunction ): void
{
    const apiKey = getApiKey( req );
    if( !apiKey )
    {
        res.status(401).send("Missing API key");
        return;
    }
    getRedisClient()
    .then( async redis => {

        const isKnown = await redis.sIsMember( `chainsync:api_keys`, apiKey );

        if( !isKnown )
        {
            res.status( 401 ).send("invalid API Key");
            return;
        }

        next();
    });
}