import { TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { Client } from "../../wsServer/Client";
import { isObject } from "@harmoniclabs/obj-utils";
import { Chain } from "../data/Chain";
import { logger } from "../../utils/Logger";

const maxLockTime = 30_000; // 30 seconds

export interface LockerInfo {
    clientIp: string;
    serverPort: number;
}

function isLockerInfo( x: any ): x is LockerInfo
{
    return (
        isObject( x ) &&
        typeof x.clientIp === "string" &&
        typeof x.serverPort === "number" &&
        x.serverPort === (x.serverPort >>> 0)
    );
}

function eqLockerInfo( a: any, b: any ): boolean
{
    if(!( isLockerInfo( a ) && isLockerInfo( b ) )) return false;

    return (
        a.clientIp === b.clientIp &&
        a.serverPort === b.serverPort
    );
}

// singleton
export class Mutex
{
    constructor(
        readonly chain: Chain
    ) {}

    readonly blockers = new Map<TxOutRefStr, LockerInfo>();

    /**
     * @returns {TxOutRefStr[]} the utxos that were locked
     */
    lock( client: LockerInfo, refs: TxOutRefStr[], required: number ): TxOutRefStr[]
    {
        if(!isLockerInfo( client )) return [];

        if( !this )
        {
            logger.error("this is missing in Mutex class");
            return [];
        }

        const lockedUtxos: TxOutRefStr[] = [];
        for( const ref of refs )
        {
            if( !this )
            {
                logger.error("this is missing in Mutex class");
                return [];
            }
            if( !this.chain )
            {
                logger.error("this.chain is missing in Mutex class");
                return [];
            }
            if( !this.chain.canMutex( ref ) ) continue;

            const currentLocker = this.blockers.get( ref );
            if( isLockerInfo( currentLocker ) ) continue; // someone is already locking the utxo

            // utxo is free, try to lock it
            lockedUtxos.push( ref );
            this.blockers.set( ref, client );

            if( lockedUtxos.length >= required ) break; // we are good
        }

        if( lockedUtxos.length < required )
        {
            // required utxos not met
            // revert the locks
            for( const ref of lockedUtxos )
            {
                this.blockers.delete( ref );
            }
            return [];
        }
        else
        {
            setTimeout( unlockCallback.bind({ self: this, client, lockedUtxos }), maxLockTime);
        }

        return lockedUtxos;
    }

    /**
     * 
     * @returns {boolean} `true` if the utxo was freed (only current locker), `false` if the utxo was already unlocked
     */
    _unlock( client: LockerInfo, ref: TxOutRefStr ): boolean
    {
        if( !this )
        {
            logger.error("this is missing in Mutex class");
        }
        // only the current locker can unlock the utxo
        if( !this.isCurrentLocker( client, ref ) ) return false;

        // client.lockedUtxos.delete( ref );
        return this.blockers.delete( ref );
    }

    unlock( client: LockerInfo, refs: TxOutRefStr[] ): TxOutRefStr[]
    {
        if( !this )
        {
            logger.error("this is missing in Mutex class");
        }
        return refs.filter( ref => this._unlock( client, ref ) );
    }

    isCurrentLocker( client: LockerInfo, ref: TxOutRefStr ): boolean
    {
        return eqLockerInfo( this.blockers.get( ref ), client );
    }
}

interface UnlockCallbackEnv {
    self: Mutex;
    client: LockerInfo;
    lockedUtxos: TxOutRefStr[];
}
function unlockCallback( this: UnlockCallbackEnv )
{
    const { self, client, lockedUtxos } = this;
    self.unlock( client, lockedUtxos );
}