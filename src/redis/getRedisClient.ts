import { createClient } from "redis";
import dotenv from "dotenv";

let redisUrl: string;
if( process.argv[2] !== "undefined" )
{
    dotenv.config({ path: process.argv[2] });
    try
    {
        redisUrl = process.env.REDIS_URL!;
    }
    catch( err )
    {
        console.log(`>>>                              WARNING                              <<<`);
        console.log(`     No REDIS_URL value has been found into the specified .env file.     `);
        console.log(`       Default Redis URL (${process.argv[5]}) will now be loaded.        `);
        console.log(`   If the URL is not the one desired, please provide a valid .env file   \n`);
        redisUrl = process.argv[5];
    }
}
else
{
    redisUrl = process.argv[5];
}

export type AnyRedisClient = Awaited<ReturnType<ReturnType<typeof createClient>["connect"]>>; 
let _redis: AnyRedisClient | undefined = undefined;

export async function getRedisClient(): Promise<AnyRedisClient>
{
    if( !_redis )
    {
        _redis = await createClient({ url: redisUrl })
            .on('error', err => console.log('Redis Client Error', err))
            .connect();

        process.on("beforeExit", async () => {
            void await _redis?.quit();
        });
    }
    return _redis;
}