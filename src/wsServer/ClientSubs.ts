import { AddressStr, TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";

export interface ClientSubs {
    readonly mutex: Set<TxOutRefStr>;
    readonly utxoFree: Set<TxOutRefStr>;
    readonly utxoLock: Set<TxOutRefStr>;
    readonly utxoSpent: Set<TxOutRefStr>;
    readonly addrFree: Set<AddressStr>;
    readonly addrLock: Set<AddressStr>;
    readonly addrSpent: Set<AddressStr>;
    readonly addrOut: Set<AddressStr>;
}

export type ClientSubsName = keyof ClientSubs;

export function createClientSubs(): ClientSubs
{
    return Object.freeze({ 
        mutex: new Set(),
        utxoFree: new Set(),
        utxoLock: new Set(),
        utxoSpent: new Set(),
        addrFree: new Set(),
        addrLock: new Set(),
        addrSpent: new Set(),
        addrOut: new Set(),
    } as ClientSubs);
}

export const clientSubsNames = Object.keys( createClientSubs() ) as ClientSubsName[];

export function isClientSubsName( thing: any ): thing is ClientSubsName
{
    return (
        typeof thing === "string" &&
        clientSubsNames.includes( thing as any )
    );
}