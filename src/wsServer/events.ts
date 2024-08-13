import { TxOutRefStr, AddressStr } from "@harmoniclabs/cardano-ledger-ts";
import { isObject } from "@harmoniclabs/obj-utils";
import { isAddrStr } from "../utils/isAddrStr";
import { isTxOutRefStr } from "../utils/isTxOutRefStr";

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

export interface SubMsg {
    sub: MutexoClientReqestEvtStr,
    filters: MsgFilter[] 
}

export function tryGetSubMsg( stuff: any ): SubMsg | undefined
{
    if( !isObject( stuff ) ) return undefined;

    const sub = stuff.sub;
    if( !isMutexoClientReqestEvtStr( sub ) ) return undefined;

    let filters = stuff.filters;
    if( !Array.isArray( filters ) ) return undefined;
    if( filters.length === 0 ) return undefined;

    filters = filters.map( tryGetMsgFilter ).filter( f => f !== undefined );

    return { sub, filters };
}

export interface UnsubMsg {
    unsub: MutexoClientReqestEvtStr
    filters?: MsgFilter[]
}

export function tryGetUnsubMsg( stuff: any ): UnsubMsg | undefined
{
    if( !isObject( stuff ) ) return undefined;

    const unsub = stuff.unsub;
    if( !isMutexoClientReqestEvtStr( unsub ) ) return undefined;

    let filters = stuff.filters;
    if( !Array.isArray( filters ) ) return { unsub };
    if( filters.length === 0 ) return { unsub };

    filters = filters.map( tryGetMsgFilter ).filter( f => f !== undefined );
     
    return { unsub, filters };
}

export interface LockMsg {
    lock: TxOutRefStr | TxOutRefStr[],
    required?: number // defaults to 1
}

export interface ResolvedLockMsg {
    lock: TxOutRefStr[],
    required: number
}

export function tryGetResolvedLockMsg( stuff: any ): ResolvedLockMsg | undefined
{
    if( !isObject( stuff ) ) return undefined;

    let lock = stuff.lock;
    if( isTxOutRefStr( lock ) ) lock = [ lock ];
    else if(!(
        Array.isArray( lock ) &&
        lock.length > 0 &&
        lock.every( isTxOutRefStr )
    )) return undefined;

    let required = 
        typeof stuff.required === "number" ?
            Math.max( Math.round( stuff.required ), 1 ) : 
            1;

    return { lock, required }
}

export interface FreeMsg {
    free: TxOutRefStr | TxOutRefStr[]
}

export interface ResolvedFreeMsg {
    free: TxOutRefStr[]
}

export function tryGetResolvedFreeMsg( stuff: any ): ResolvedFreeMsg | undefined
{
    if( !isObject( stuff ) ) return undefined;

    let free = stuff.free;
    if( isTxOutRefStr( free ) ) free = [ free ];
    else if(!(
        Array.isArray( free ) &&
        free.length > 0 &&
        free.every( isTxOutRefStr )
    )) return undefined;

    return { free };
}