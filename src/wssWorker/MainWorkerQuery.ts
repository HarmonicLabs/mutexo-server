import { Tx, TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { MessagePort } from "node:worker_threads";
import { LockerInfo } from "../state/mutex/mutex";
import { Client } from "../wsServer/Client";

export type MainWorkerQueryName
    = "incrementLeakingBucket"
    | "getAuthTokenSecret"
    | "resolveUtxos"
    | "lock"
    | "unlock";

export function isQueryMessageName( str: string ): str is MainWorkerQueryName
{
    return (
        str === "incrementLeakingBucket"    ||
        str === "getAuthTokenSecret"        ||
        str === "resolveUtxos"              ||
        str === "lock"                      ||
        str === "unlock"
    ); 
}

export interface QueryRequest<Name extends MainWorkerQueryName = MainWorkerQueryName> {
    id: number;
    type: Name;
    args: QueryArgsOf<Name>;
}

export function isIncrLeakingBucketQueryRequest( obj: any ): obj is QueryRequest<"incrementLeakingBucket">
{
    return obj.type === "incrementLeakingBucket";
}

export function isGetAuthTokenSecretQueryRequest( obj: any ): obj is QueryRequest<"getAuthTokenSecret">
{
    return obj.type === "getAuthToken";
}

export function isResolveUtxosQueryRequest( obj: any ): obj is QueryRequest<"resolveUtxos">
{
    return obj.type === "resolveUtxos";
}

export function isLockQueryRequest( obj: any ): obj is QueryRequest<"lock">
{
    return obj.type === "lock";
}

export function isUnlockQueryRequest( obj: any ): obj is QueryRequest<"unlock">
{
    return obj.type === "unlock";
}

export type QueryArgsOf<Name extends MainWorkerQueryName> =
    Name extends "incrementLeakingBucket" ? [ ip: string ] :
    Name extends "getAuthTokenSecret" ? [ token: string ] :
    Name extends "resolveUtxos" ? [ refs: TxOutRefStr[] ] :
    Name extends "lock" ? [ client: LockerInfo, refs: TxOutRefStr[], required: number ] :
    Name extends "unlock" ? [ client: LockerInfo, refs: TxOutRefStr[] ] :
    any[];
    
export interface QueryResultMessageData<T = any> {
    id: number;
    result: T;
}

export class MainWorkerQuery
{
    readonly parentPort: MessagePort;
    constructor( parentPort: MessagePort | null )
    {
        if(!( parentPort instanceof MessagePort )) throw new Error( "parentPort is null" );
        this.parentPort = parentPort;
    }

    private readonly pendingIds = new Map<number, (result: any) => any>();

    /**
     * to be used in the main listener in wss
     */
    dispatchEvent({ id, result }: QueryResultMessageData )
    {
        this.pendingIds.get( id )?.( result );
        this.pendingIds.delete( id );
    }

    private _getId (): number
    {
        if( this.pendingIds.size > 0xbfff_ffff )
            throw new Error( "Too many pending requests" );
        
        let id: number;
        do{
            id = ( Math.random() * 0xffff_ffff ) >>> 0
        } while( this.pendingIds.has( id ) );
        // this.pendingIds.set( id, nop );
        return id;
    }

    private _send( type: MainWorkerQueryName, args: any[] ): Promise<any>
    {
        const self = this;
        return new Promise( resolve => {
            const id = self._getId ();
            self.pendingIds.set( id, resolve );
            self.parentPort.postMessage({
                id,
                type,
                args
            });
        });
    }

    incrementLeakingBucket( ip: string ): Promise<boolean>
    {
        return this._send( "incrementLeakingBucket", [ ip ] );
    }

    getAuthTokenSecret( token: string ): Promise<Uint8Array | undefined>
    {
        return this._send( "getAuthTokenSecret", [ token ] );
    }

    resolveUtxos( refs: TxOutRefStr[] ): Promise<ResolvedSerializedUtxo[]>
    {
        return this._send( "resolveUtxos", [ refs ] );
    }

    lock( client: LockerInfo, refs: TxOutRefStr[], required: number ): Promise<TxOutRefStr[]>
    {
        return this._send( "lock", [ client, refs, required ] );
    }

    unlock( client: LockerInfo, refs: TxOutRefStr[] ): Promise<TxOutRefStr[]>
    {
        return this._send( "unlock", [ client, refs ] );
    }
}

export interface ResolvedSerializedUtxo {
    ref: TxOutRefStr;
    out: Uint8Array | undefined;
}