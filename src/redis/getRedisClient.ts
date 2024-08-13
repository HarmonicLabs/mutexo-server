import { createClient } from "redis";

export type AnyRedisClient = Awaited<ReturnType<ReturnType<typeof createClient>["connect"]>>; 
let _redis: AnyRedisClient | undefined = undefined;

export async function getRedisClient(): Promise<AnyRedisClient>
{
    if( !_redis )
    {
        _redis = await createClient()
            .on('error', err => console.log('Redis Client Error', err))
            .connect();

        process.on("beforeExit", async () => {
            void await _redis?.quit();
        });
    }
    return _redis;
}