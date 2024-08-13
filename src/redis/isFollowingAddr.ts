import { AddressStr } from "@harmoniclabs/cardano-ledger-ts";
import { API_KEY } from "../wsServer/clientProps";
import { getRedisClient } from "./getRedisClient";
import { ADDR_TO_API_SET_PREFIX, API_TO_ADDR_SET_PREFIX } from "../constants";

export async function addressIsFollowed( addr: AddressStr ): Promise<boolean>
{
    const redis = await getRedisClient();
    return await redis.sCard( `${ADDR_TO_API_SET_PREFIX}:${addr}` ) > 0;
}

export async function isFollowingAddr( apiKey: API_KEY, addr: AddressStr ): Promise<boolean>
{
    const redis = await getRedisClient();
    return await redis.sIsMember( `${ADDR_TO_API_SET_PREFIX}:${addr}`, apiKey );
}

export async function followAddr( addr: AddressStr, apiKey: API_KEY ): Promise<void>
{
    const redis = await getRedisClient();
    await redis.sAdd( `${ADDR_TO_API_SET_PREFIX}:${addr}`, apiKey );
    await redis.sAdd( `${API_TO_ADDR_SET_PREFIX}:${apiKey}`, addr );
}

export async function unfollowAddr( addr: AddressStr, apiKey: API_KEY ): Promise<void>
{
    const redis = await getRedisClient();
    
    let card =  await redis.sRem( `${ADDR_TO_API_SET_PREFIX}:${addr}`, apiKey );
    if( card <= 0 )   redis .del( `${ADDR_TO_API_SET_PREFIX}:${addr}` );
    
    card =      await redis.sRem( `${API_TO_ADDR_SET_PREFIX}:${apiKey}`, addr );
    if( card <= 0 )   redis .del( `${API_TO_ADDR_SET_PREFIX}:${apiKey}` );
}