import { TxOutRefStr, AddressStr } from "@harmoniclabs/cardano-ledger-ts";
import { isNonEmptySet } from "../utils/isNonEmptyArray";
import type { WebSocket } from "ws";

export type API_KEY = string;

export function getClientApiKey( client: any ): API_KEY | undefined
{
    const k = client?.API_KEY;
    return typeof k === "string" ? k : undefined;
}
export function setClientApiKey( client: any, apiKey: API_KEY ): void
{
    client.API_KEY = apiKey;
}

export function getWsClientIp( client: WebSocket ): string
{
    return (client as any).REMOTE_IP;
}

export function setWsClientIp( client: WebSocket, ip: string ): void
{
    (client as any).REMOTE_IP = ip;
}

export function getClientUtxoMutexSubs( client: any ): Set<TxOutRefStr>
{
    let subs = client.UTXO_MUTEX_SUBS;
    if(!( subs instanceof Set ))
    {
        subs = client.UTXO_MUTEX_SUBS = new Set();
    }
    return subs;
}

export function getClientUtxoFreeSubs( client: any ): Set<TxOutRefStr>
{
    let subs = client.UTXO_FREE_SUBS;
    if(!( subs instanceof Set ))
    {
        subs = client.UTXO_MUTEX_SUBS = new Set();
    }
    return subs;
}
export function getClientUtxoLockSubs( client: any ): Set<TxOutRefStr>
{
    let subs = client.UTXO_FREE_SUBS;
    if(!( subs instanceof Set ))
    {
        subs = client.UTXO_MUTEX_SUBS = new Set();
    }
    return subs;
}

export function getClientUtxoSpentSubs( client: any ): Set<TxOutRefStr>
{
    let subs = client.UTXO_SPENT_SUBS;
    if(!( subs instanceof Set ))
    {
        subs = client.UTXO_SPENT_SUBS = new Set();
    }
    return subs;
}

export function getClientAddrFreeSubs( client: any ): Set<AddressStr>
{
    let subs = client.ADDR_FREE_SUBS;
    if(!( subs instanceof Set ))
    {
        subs = client.ADDR_FREE_SUBS = new Set();
    }
    return subs;
}

export function getClientAddrLockSubs( client: any ): Set<AddressStr>
{
    let subs = client.ADDR_LOCK_SUBS;
    if(!( subs instanceof Set ))
    {
        subs = client.ADDR_LOCK_SUBS = new Set();
    }
    return subs;
}

export function getClientAddrSpentSubs( client: any ): Set<AddressStr>
{
    let subs = client.ADDR_SPENT_SUBS;
    if(!( subs instanceof Set ))
    {
        subs = client.ADDR_SPENT_SUBS = new Set();
    }
    return subs;
}

export function getClientOutputsSubs( client: any ): Set<AddressStr>
{
    let subs = client.OUTPUT_SUBS;
    if(!( subs instanceof Set ))
    {
        subs = client.OUTPUT_SUBS = new Set();
    }
    return subs;
}