import { TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { getWsClientIp } from "../../clientProps";
import { utxoBlockers } from "./utxoBlockers";
import { WebSocket } from "ws";

export function isBlockingUTxO(client: WebSocket, ref: TxOutRefStr): boolean
{
    const wsInstance = utxoBlockers.get(ref);
    if (!wsInstance) return false;

    const clientIP = getWsClientIp(client);
    if (!clientIP) return false;

    const wsIP = getWsClientIp(wsInstance);
    if (!wsIP) return false;

    return clientIP === wsIP;
}