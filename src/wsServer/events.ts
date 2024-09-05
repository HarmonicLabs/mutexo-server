import { ClientReqFree, ClientReqLock, ClientSub, ClientUnsub } from "@harmoniclabs/mutexo-messages";
import { TxOutRefStr, AddressStr } from "@harmoniclabs/cardano-ledger-ts";
import { isTxOutRefStr } from "../utils/isTxOutRefStr";
import { isObject } from "@harmoniclabs/obj-utils";
import { isAddrStr } from "../utils/isAddrStr";

export enum MutexoServerEvent {
    Free    = "Free",
    Lock    = "Lock",
    Input   = "Input",
    Output  = "Output",
    Success = "Success",
    Failure = "Failure",
    Close   = "Close",
    Error   = "Error",
}

Object.freeze( MutexoServerEvent );

export type MutexoEvent
    = MutexoServerEvent.Free
    | MutexoServerEvent.Lock
    | MutexoServerEvent.Input
    | MutexoServerEvent.Output
    | MutexoServerEvent.Success
    | MutexoServerEvent.Failure
    | MutexoServerEvent.Close
    | MutexoServerEvent.Error
    | "Free"
    | "Lock"
    | "Input"
    | "Output"
    | "Success"
    | "Failure"
    | "Close"
    | "Error";

export type MutexoClientReqestEvtStr
    = "Free"
    | "Lock"
    | "Input"
    | "Output";

export type MutexoServerEventStr
    = MutexoClientReqestEvtStr
    | "Success"
    | "Close"
    | "Error";

export function isMutexoClientReqestEvtStr( str: string ): str is MutexoClientReqestEvtStr
{
    return (
        str === "Free"      ||
        str === "Lock"      ||
        str === "Input"     ||
        str === "Output"
    );
}

type MsgFilter
    = { ref: TxOutRefStr, addr?: undefined }
    | { addr: AddressStr, ref ?: undefined };

export function tryGetMsgFilter( stuff: any ): MsgFilter | undefined
{
    if( !isObject( stuff ) ) return undefined;

    const addr = stuff.addr;
    if( isAddrStr( addr ) ) return { addr };

    const ref = stuff.ref;
    if( isTxOutRefStr( ref ) ) return { ref };

    return undefined;
}
