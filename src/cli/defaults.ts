import { AddressStr } from "@harmoniclabs/cardano-ledger-ts";

export const defaultConfigPath = "./mutexo-config.json";
export const defaultTxs = 2;
export const defaultTest = true;
export const defaultRedisUrl = "redis://localhost:6379";
// export const defaultNodeSocketPath = "./node.socket";
export const defaultIngoreDotenv = false;
export const defaultAddrs: Readonly<AddressStr[]> = Object.freeze([]);
export const defaultWssPort = 3001;