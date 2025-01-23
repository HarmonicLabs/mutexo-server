import { TxOutRefStr, AddressStr, TxOut, TxOutRef, UTxO, Address } from "@harmoniclabs/cardano-ledger-ts";
import { BlockInfosWithHash, TxIO } from "../../types/BlockInfos";
import { logger } from "../../utils/Logger";
import { ResolvedSerializedUtxo } from "../../wssWorker/MainWorkerQuery";
import { SharedAddrStr } from "../../utils/SharedAddrStr";

export interface UtxoSetEntry {
    bytes: Uint8Array,
    isSpent: boolean,
    addr: SharedAddrStr
}

// singleton
export class Chain
{
    constructor() {}

    readonly blocks: BlockInfosWithHash[] = [];

    /**
     * map from TxOutRefStr to the resolved tx out (serialized in cbor)
     */
    readonly utxoSet = new Map<TxOutRefStr, UtxoSetEntry>();

    /**
     * allows to quickly find the utxos of an address
     */
    readonly addrUtxoIndex = new Map<SharedAddrStr, Set<TxOutRefStr>>();

    tip: string = "";

    /**
     * @returns {boolean} `true` if the utxo exists, is followed, and has not been spent;
     * `false` otherwise
     */
    canMutex( ref: TxOutRefStr ): boolean
    {
        const entry = this.utxoSet.get( ref );
        if( !entry ) return false;
        return !entry.isSpent;
    }

    resolveUtxo( ref: TxOutRefStr ): ResolvedSerializedUtxo
    {
        return {
            ref,
            out: this.utxoSet.get( ref )?.bytes
        }
    }

    resolveUtxos( refs: TxOutRefStr[] ): ResolvedSerializedUtxo[]
    {
        const self = this;
        return refs.map( ref => self.resolveUtxo(ref) );
    }

    getAddrUtxos( _addr: AddressStr | SharedAddrStr ): Set<TxOutRefStr>
    {
        const addr = _addr instanceof SharedAddrStr ? _addr : SharedAddrStr.getIfExists( _addr );
        if( !addr ) return new Set();
        
        let utxos = this.addrUtxoIndex.get( addr )
        if( !utxos )
        {
            utxos = new Set();
            this.addrUtxoIndex.set( addr, utxos );
        }
        return utxos;
    }

    hasBlock( hashStr: string ): boolean
    {
        // return this.blocks.includes( hashStr );
        for( let i = this.blocks.length - 1; i >= 0; i-- )
        {
            if( this.blocks[i].hash === hashStr ) return true;
        }
        return false;
    }

    revertUntilHash( hashStr: string ): BlockInfosWithHash[]
    {
        if( !this.hasBlock( hashStr ) ) return [];

        const revertedBlocks: BlockInfosWithHash[] = [];

        while( this.tip !== hashStr )
        {
            const blockInfos = this.blocks.pop();
            if( !blockInfos ) throw new Error( "Chain is empty" );

            revertedBlocks.push( blockInfos );
            this.tip = blockInfos.prev; // update tip

            this.revertTxs( blockInfos.txs );
        }

        return revertedBlocks;
    }

    saveTxOut( out: TxOut, ref: TxOutRefStr, address?: AddressStr ): void
    {
        const bytes = out.toCbor().toBuffer();
        const addr = SharedAddrStr.getIfExists( address ?? out.address.toString() );
        if( !addr ) return;

        this.utxoSet.set( ref, { bytes, isSpent: false, addr } );
        this.getAddrUtxos( addr ).add( ref );
    }

    // saveUtxos( utxos: UTxO[] ): void
    // {
    //     for( const u of utxos )
    //     {
    //         this.saveTxOut( u.resolved, u.utxoRef.toString() );
    //     }
    // }

    spend( ref: TxOutRefStr ): UtxoSetEntry | undefined
    {
        const entry = this.utxoSet.get( ref );
        if( !entry ) return undefined;
        entry.isSpent = true;
        return entry;
    }

    private revertTxs( txs: TxIO[] ): void
    {
        // from last to first transaction in block
        // to account for chained utxos
        for( let i = txs.length - 1; i >= 0; i-- )
        {
            const { ins, outs } = txs[i];

            this.revertTxsOuts( outs );
            this.revertTxsIns( ins );
            // mutex is managed in the websocket server
            // we are rolling back, so the utxo is free to be used, no matter if a user blocked or not
        }
    }

    private revertTxsOuts( outs: TxOutRefStr[] ): void
    {
        for( const out of outs )
        {
            const entry = this.utxoSet.get( out );
            if( !entry )
            {
                logger.debug( "missing utxo", out );
                continue;
            }
            const txOut = TxOut.fromCbor( entry.bytes );
    
            // WE CANNOT DELETE THE UTXO,
            // IT MAY BE RECREATED ON THE NEW FORK
            // this.utxoSet.delete( out );
            entry.isSpent = true;
    
            const addr = SharedAddrStr.getIfExists( txOut.address.toString() );
            if( !addr ) continue;

            const addrUtxos = this.addrUtxoIndex.get( addr );
            if( !addrUtxos )
            {
                logger.debug( "missing addrUtxos", addr );
                continue;
            }
            addrUtxos.delete( out );
        }
    }

    private revertTxsIns( ins: TxOutRefStr[] ): void
    {
        // un-spend utxo spent (inputs)
        for( const ref of ins )
        {
            const entry = this.utxoSet.get( ref );
            if( !entry ) continue;
            const txOut = TxOut.fromCbor( entry.bytes );
            entry.isSpent = false;
    
            const addr = SharedAddrStr.getIfExists( txOut.address.toString() );
            if( !addr ) continue;

            let addrUtxos = this.addrUtxoIndex.get( addr );
            if( !addrUtxos )
            {
                addrUtxos = new Set();
                this.addrUtxoIndex.set( addr, addrUtxos );
            }
            addrUtxos.add( ref );
        }
    }
}