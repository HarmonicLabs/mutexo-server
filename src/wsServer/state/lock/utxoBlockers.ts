import { TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { WebSocket } from "ws";

/**
 * blocked utxos refs mapped to the client that locked them
 */
export const utxoBlockers: Map<TxOutRefStr, WebSocket> = new Map();