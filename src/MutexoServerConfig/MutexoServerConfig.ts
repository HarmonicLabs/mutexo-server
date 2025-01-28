import { AddressStr } from "@harmoniclabs/cardano-ledger-ts";
import { LogLevel } from "../utils/Logger";

export interface MutexoServerCliArgs {
    config: string;
    network: "mainet" | "preview" | "preprod" | number;
    threads: string;
    logLevel: string;
    nodeSocketPath: string;
    httpPort: number;
    wsPort: any[];
    portRange: string; // /\b\d{2,5}-\d{2,5}\b/
    addr: string[];
    ignoreEnv: boolean;
    disableLogColors: boolean;
}

export interface MutexoServerConfig {
    network: number;
    threads: number;
    logLevel: LogLevel;
    nodeSocketPath: string;
    httpPort: number;
    wsPorts: number[];
    portRange: [number, number];
    addrs: AddressStr[];
    ignoreEnv: boolean;
    disableLogColors: boolean;
}