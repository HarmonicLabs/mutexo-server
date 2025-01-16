import { TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { utxoBlockers } from "./utxoBlockers";
import { WebSocket } from "ws";

/**
 * locks the utxo for the client 
 * @returns {boolean} `true` if the operation was succesful, `false` otherwise
 */
export function lockUTxO(client: WebSocket, ref: TxOutRefStr): boolean {
    // if true means utxo is already locked
    if (utxoBlockers.get(ref)) return false;

    utxoBlockers.set(ref, client);

    return true;
}