import { AddressStr } from "@harmoniclabs/cardano-ledger-ts";

export const defaultConfigPath = "./mutexo-config.json";
export const defaultTxs = 2;
export const defaultTest = true;
// export const defaultNodeSocketPath = "./node.socket";
export const defaultIngoreDotenv = false;
export const defaultAddrs: Readonly<AddressStr[]> = Object.freeze([]);
export const defaultHttpPort = 3001;
export const defaultPortRange: [number, number] = [ 3001, 4000 ];
export const defaultPortRangeStr = defaultPortRange.join("-");
export const defaultWssPorts: number[] = []; // Object.freeze( new Array( 32 ).fill( 0 ).map( (_, i) => 3002 + i ) );
export const defaultNetwork = "mainnet";
export const defaultThreads = "50%";