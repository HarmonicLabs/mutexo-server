
export interface MutexoServerCliArgs {
    configPath: string;
    network: "mainet" | "preview" | "preprod" | number;
    ignoreEnv: boolean;
    addr: string[];
    nodeSocketPath: string;
    redisUrl: string;
    port: number;
}

export interface MutexoServerConfig {
    ignoreEnv: boolean;
    network: number;
    nodeSocketPath: string;
    redisUrl: string;
    addrs: string[];
    port: number;
}