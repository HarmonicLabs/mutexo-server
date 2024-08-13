import { BLOCK_PREFIX } from "../constants";
import { getRedisClient } from "./getRedisClient"

export async function hasBlockHash( hashStr: string ): Promise<boolean>
{
    const redis = await getRedisClient();
    return await redis.exists(`${BLOCK_PREFIX}:${hashStr}`) > 0;
}