import { MutexoServerConfig } from "./MutexoServerConfig/MutexoServerConfig";
import { getRedisClient } from "./redis/getRedisClient";

export async function setupWorker( cfg: MutexoServerConfig )
{
    void await getRedisClient( cfg.redisUrl );
}