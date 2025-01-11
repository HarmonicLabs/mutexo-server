
export interface MutexoServerCliArgs {
    configPath: string;
    ignoreEnv: boolean;
    addr: string[];
    nodeSocketPath: string;
    redisUrl: string;
    port: number;
}

export interface MutexoServerConfig {
    ignoreEnv: boolean;
    nodeSocketPath: string;
    redisUrl: string;
    addrs: string[];
    port: number;
}