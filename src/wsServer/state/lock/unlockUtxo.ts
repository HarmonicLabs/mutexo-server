import { TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { isBlockingUTxO } from "./isBlockingUtxo";
import { utxoBlockers } from "./utxoBlockers";
import { WebSocket } from "ws";

/**
 * @returns {boolean} `true` if the operation was succesful, `false` otherwise
 */
export function unlockUTxO(client: WebSocket, ref: TxOutRefStr): boolean
{
    if( !isBlockingUTxO( client, ref ) ) return false;

    // `isBlockingUTxO` returned true, so we know we have a WebSocket client
    utxoBlockers.delete( ref );

    return true;
}