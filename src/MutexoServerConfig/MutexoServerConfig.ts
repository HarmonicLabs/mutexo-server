
export interface MutexoServerCliArgs {
    configPath: string;
    network: "mainet" | "preview" | "preprod" | number;
    ignoreEnv: boolean;
    addr: string[];
    nodeSocketPath: string;
    port: number;
}

export interface MutexoServerConfig {
    ignoreEnv: boolean;
    network: number;
    nodeSocketPath: string;
    addrs: string[];
    port: number;
}