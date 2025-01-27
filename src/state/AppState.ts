import { webcrypto } from "node:crypto";
import { Chain } from "./data/Chain";
import { LeakingBucket } from "./rate-limit/LeakingBucket";
import jwt from "jsonwebtoken";
import { Worker } from "node:worker_threads";
import { isGetAuthTokenSecretQueryRequest, isIncrLeakingBucketQueryRequest, isLockQueryRequest, isResolveUtxosQueryRequest, isUnlockQueryRequest, QueryRequest } from "../wssWorker/MainWorkerQuery";
import { Mutex } from "./mutex/mutex";
import { AddressStr, TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { MutexEventInfos } from "../wsServer/MutexEventInfos";
import { MutexoServerConfig } from "../MutexoServerConfig/MutexoServerConfig";
import { SharedAddrStr } from "../utils/SharedAddrStr";

const sign = jwt.sign;

export interface AuthValidationInfos {
    secret: Uint8Array;
    wsServerPort: number;
}

export class AppState
{
    constructor(
        readonly config: MutexoServerConfig,
        readonly wssWorkers: Worker[]
    )
    {
        this.followedAddrs = new Set( config.addrs.map( SharedAddrStr.get ) );
        this.chain = new Chain();
        this.mutex = new Mutex( this.chain );
    }

    readonly authTokens = new Map<string, AuthValidationInfos>();
    readonly leakingBucket = new LeakingBucket();
    readonly chain: Chain;
    readonly mutex: Mutex;
    readonly followedAddrs: Set<SharedAddrStr>;

    isFollowing( addr: AddressStr | SharedAddrStr ): boolean
    {
        const shared = SharedAddrStr.getIfExists( addr );
        if( !shared ) return false;
        const result = this.followedAddrs.has( shared );
        if( !result ) SharedAddrStr.forget( addr );
        return result;
    }

    getNewAuthToken( ip: string, wsServerPort: number ): string
    {
        let secret = new Uint8Array(32);
        let tokenStr: string;

        const expirationSeconds = 30;
    
        do {
            webcrypto.getRandomValues( secret );
            tokenStr = sign(
                { ip },
                Buffer.from( secret ),
                { expiresIn: expirationSeconds }
            );
        } while( this.authTokens.has( tokenStr ) );
    
        this.authTokens.set( tokenStr, { secret, wsServerPort } );

        // expires
        setTimeout(() => {
            this.authTokens.delete( tokenStr );
        }, expirationSeconds * 1000);

        return tokenStr;
    }

    private _sendQueryResult( worker: Worker, id: number, result: any )
    {
        worker.postMessage({
            type: "queryResult",
            data: {
                id,
                result
            }
        });
    }

    handleQueryMessage( msg: QueryRequest, wssWorker: Worker )
    {
        if( isIncrLeakingBucketQueryRequest( msg ) )
        {
            const [ ip ] = msg.args;
            const success = this.leakingBucket.increment( ip );
            this._sendQueryResult( wssWorker, msg.id, success );
            return;
        }
        if( isGetAuthTokenSecretQueryRequest( msg ) )
        {
            const [ token ] = msg.args;
            const validationInfos = this.authTokens.get( token );
            this._sendQueryResult( wssWorker, msg.id, validationInfos );
            return;
        }
        if( isResolveUtxosQueryRequest( msg ) )
        {
            const [ refs ] = msg.args;
            const utxos = this.chain.resolveUtxos( refs );
            this._sendQueryResult( wssWorker, msg.id, utxos );
            return;
        }
        if( isLockQueryRequest( msg ) )
        {
            const [ client, refs, _required ] = msg.args;
            const required = Math.max( 1, _required ) >>> 0;
            const lockedRefs = this.mutex.lock(
                client,
                refs,
                required
            );
            this._sendQueryResult( wssWorker, msg.id, lockedRefs );
            if( lockedRefs.length >= required )
            {
                for( const worker of this.wssWorkers )
                {
                    worker.postMessage({
                        type: "lock",
                        data: lockedRefs.map( this._getMutexEventInfos )
                    });
                }
            }
            return;
        }
        if( isUnlockQueryRequest( msg ) )
        {
            const [ client, refs ] = msg.args;
            const unlocked = this.mutex.unlock( client, refs );
            this._sendQueryResult( wssWorker, msg.id, unlocked);
            if( unlocked.length > 0 )
            {
                for( const worker of this.wssWorkers )
                {
                    worker.postMessage({
                        type: "free",
                        data: unlocked.map( this._getMutexEventInfos )
                    });
                }
            }
            return;
        }
        
        throw new Error( "Unknown query" );
    }

    private _getMutexEventInfos( ref: TxOutRefStr ): MutexEventInfos
    {
        return {
            ref,
            addr: this.chain.utxoSet.get( ref )!.addr.toString()
        };
    }
}