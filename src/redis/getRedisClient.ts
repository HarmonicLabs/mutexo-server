import { createClient } from "redis";

export type AnyRedisClient = Awaited<ReturnType<ReturnType<typeof createClient>["connect"]>>; 
let _redis: AnyRedisClient | undefined = undefined;

export function getRedisClient(): AnyRedisClient
export function getRedisClient( redisUrl: string ): Promise<AnyRedisClient> | AnyRedisClient
export function getRedisClient( redisUrl?: string ): Promise<AnyRedisClient> | AnyRedisClient
{
    if( !_redis )
    {
        if( typeof redisUrl !== "string" ) throw new Error("No redis url provided");

        return Promise.resolve()
        .then( async _ => {
    
            _redis = await createClient({ url: redisUrl })
                .on('error', err => console.error('[Redis Client Error]', err))
                .connect();
    
            process.on("beforeExit", async () => {
                void await _redis?.quit();
            });

            return _redis;
        });
    }
    return _redis;
}