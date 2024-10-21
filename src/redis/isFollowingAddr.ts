import { ADDR_TO_API_SET_PREFIX, API_TO_ADDR_SET_PREFIX, PUBLIC_API_KEY } from "../constants";
import { AddressStr } from "@harmoniclabs/cardano-ledger-ts";
import testAddrs from "../testdata/startupAddrs.json";
import { Logger, LogLevel } from "../utils/Logger";
import { getRedisClient } from "./getRedisClient";

export async function addressIsFollowed( ipAddress: AddressStr ): Promise<boolean>
{
    const redis = await getRedisClient();
    return await redis.sCard( `${ADDR_TO_API_SET_PREFIX}:${ipAddress}` ) > 0;
}

export async function isFollowingAddr( ipAddress: AddressStr ): Promise<boolean>
{
    const redis = await getRedisClient();
    return await redis.sIsMember( `${ADDR_TO_API_SET_PREFIX}:${ipAddress}`, PUBLIC_API_KEY );
}

export async function followAddr( ipAddress: AddressStr ): Promise<void>
{
    const redis = await getRedisClient();
    await redis.sAdd( `${ADDR_TO_API_SET_PREFIX}:${ipAddress}`, PUBLIC_API_KEY );
    // await redis.sAdd( `${API_TO_ADDR_SET_PREFIX}:${PUBLIC_API_KEY}`, ipAddress );
}

export async function unfollowAddr( ipAddress: AddressStr ): Promise<void>
{
    const redis = await getRedisClient();
    
    let card = await redis.sRem( `${ADDR_TO_API_SET_PREFIX}:${ipAddress}`, PUBLIC_API_KEY );
    if( card <= 0 ) redis.del( `${ADDR_TO_API_SET_PREFIX}:${ipAddress}` );
    
    // let card = await redis.sRem( `${API_TO_ADDR_SET_PREFIX}:${PUBLIC_API_KEY}`, ipAddress );
    // if( card <= 0 ) redis.del( `${API_TO_ADDR_SET_PREFIX}:${PUBLIC_API_KEY}` );
}

// DEVELOPMENT TEST CODE

const logger = new Logger({ logLevel: LogLevel.DEBUG });

export async function followTestAddrs(): Promise<void>
{
	for( const testAddr of testAddrs )
	{
		await followAddr( testAddr.addr as AddressStr ).then(
			() => logger.debug(`> FOLLOWED ADDRESS: ${testAddr.addr} <\n`)
		);
	}
}

export async function verifyFollowedTestAddrs(): Promise<void>
{
	for( const testAddr of testAddrs )
	{
		await isFollowingAddr( testAddr.addr as AddressStr ).then(
			( isFollowing ) => logger.debug("> ", testAddr.addr, " HAS BEEN FOLLOWED: ", isFollowing, " <\n")
		);
	}
}