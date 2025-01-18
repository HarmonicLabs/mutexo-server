import { TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { Client } from "../../wsServer/Client";

const maxLockTime = 30_000; // 30 seconds

// singleton
export class Mutex
{
    private constructor() {}

    static readonly blockers = new Map<TxOutRefStr, Client>();

    /**
     * 
     * @returns {boolean} `true` if the client locked the utxos, `false` if the utxo was already locked
     */
    static lock( ref: TxOutRefStr, client: Client ): boolean
    {
        if(!( client instanceof Client )) return false;

        const currentBlocker = Mutex.blockers.get( ref );
        if( currentBlocker === client ) return true;
        if( currentBlocker instanceof Client ) return false;
        
        // lock for the first time
        Mutex.blockers.set( ref, client );
        client.lockedUtxos.add( ref );

        setTimeout(() => Mutex.unlock( client, ref ), maxLockTime);
        return true;
    }

    /**
     * 
     * @returns {boolean} `true` if the utxo was freed (only current locker), `false` if the utxo was already unlocked
     */
    static unlock( client: Client, ref: TxOutRefStr ): boolean
    {
        // only the current locker can unlock the utxo
        if( !Mutex.isCurrentLocker( client, ref ) ) return false;

        this.blockers.delete( ref );
        client.lockedUtxos.delete( ref );
        return true;
    }

    static isCurrentLocker( client: Client, ref: TxOutRefStr ): boolean
    {
        if(!( client instanceof Client )) return false;

        return Mutex.blockers.get( ref ) === client;
    }
}