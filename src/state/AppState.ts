import { webcrypto } from "node:crypto";
import { Chain } from "./data/Chain";
import { LeakingBucket } from "./rate-limit/LeakingBucket";
import { sign } from "jsonwebtoken";
import { Worker } from "node:worker_threads";
import { isGetAuthTokenSecretQueryRequest, isIncrLeakingBucketQueryRequest, isResolveUtxosQueryRequest, QueryRequest } from "../workers/MainWorkerQuery";

export class AppState
{
    constructor() {}

    readonly authTokens = new Map<string, Uint8Array>();
    readonly leakingBucket = new LeakingBucket();
    readonly chain = new Chain();

    getNewAuthToken( ip: string ): string
    {
        let secretBytes = new Uint8Array(32);
        let tokenStr: string;

        const expirationSeconds = 30;
    
        do {
            webcrypto.getRandomValues( secretBytes );
            tokenStr = sign(
                { ip },
                Buffer.from( secretBytes ),
                { expiresIn: expirationSeconds }
            );
        } while( this.authTokens.has( tokenStr ) );
    
        this.authTokens.set( tokenStr, secretBytes );

        // expires
        setTimeout(() => {
            this.authTokens.delete( tokenStr );
        }, expirationSeconds * 1000);

        return tokenStr;
    }

    handleQueryMessage( msg: QueryRequest, wssWorker: Worker )
    {
        if( isIncrLeakingBucketQueryRequest( msg ) )
        {
            const [ ip ] = msg.args;
            const success = this.leakingBucket.increment( ip );
            wssWorker.postMessage({
                type: "queryResult",
                data: {
                    id: msg.id,
                    result: success
                }
            });
            return;
        }
        if( isGetAuthTokenSecretQueryRequest( msg ) )
        {
            const [ token ] = msg.args;
            const secretBytes = this.authTokens.get( token );
            wssWorker.postMessage({
                type: "queryResult",
                data: {
                    id: msg.id,
                    result: secretBytes
                }
            });
            return;
        }
        if( isResolveUtxosQueryRequest( msg ) )
        {
            const [ refs ] = msg.args;
            const utxos = this.chain.resolveUtxos( refs );
            wssWorker.postMessage({
                type: "queryResult",
                data: {
                    id: msg.id,
                    result: utxos
                }
            });
            return;
        }
        
        throw new Error( "Unknown query" );
    }
}