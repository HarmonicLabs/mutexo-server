import { BLOCKS_QUEQUE_KEY, BLOCK_PREFIX, MAX_N_VOLATILE_BLOCKS, TIP_HASH_KEY, UTXO_PREFIX, UTXO_VALUE_PREFIX } from "../constants";
import { Cbor, LazyCborArray, CborArray, CborUInt } from "@harmoniclabs/cbor";
import { BlockInfos, TxIO, tryGetBlockInfos } from "../types/BlockInfos";
import { Tx, TxBody, TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { getRedisClient } from "../redis/getRedisClient";
import { saveTxOut } from "../funcs/saveUtxos";
import { parentPort } from "worker_threads";
import { createHash } from "blake2";
import { toHex } from "@harmoniclabs/uint8array-utils";

function blake2b_256( data: Uint8Array ): string
{
    return createHash("blake2b", { digestLength: 32 }).update(Buffer.from( data )).digest("hex")
}

function blake2b_256_bytes( data: Uint8Array ): Buffer
{
    return createHash("blake2b", { digestLength: 32 }).update(Buffer.from( data )).digest();
}

parentPort?.on("message", parseBlock);

async function parseBlock( blockData: Uint8Array ): Promise<void>
{
    const lazyBlock = Cbor.parseLazy( blockData );

    if(!( lazyBlock instanceof LazyCborArray ))
    {
        throw new Error("invalid CBOR for block");
    }

    const headerData = lazyBlock.array[0];

    const block_hash = blake2b_256( headerData );

    const headerBodyCbor = ((Cbor.parse( headerData ) as CborArray).array[0] as CborArray).array;

    const lazyTxsBodies = Cbor.parseLazy( lazyBlock.array[1] );
    const lazyTxsWitnesses = Cbor.parseLazy( lazyBlock.array[2] );

    if(!( lazyTxsBodies instanceof LazyCborArray ))
    {
        throw new Error("invalid CBOR for block");
    }
    if(!( lazyTxsWitnesses instanceof LazyCborArray ))
    {
        throw new Error("invalid CBOR for block");
    }

    const txsBodies = lazyTxsBodies.array;

    const redis = await getRedisClient();

    // get the previous hash from redis rather than the block
    // so even if it is not the one on chain we are sure we have something 
    const prevHash: string = await redis.get( TIP_HASH_KEY ) ?? "";
        // headerBodyCbor[2] instanceof CborBytes ?
        // toHex( headerBodyCbor[2].buffer ) :
        // "";

    // change the tip
    redis.set( TIP_HASH_KEY, block_hash );

    const blockInfos: BlockInfos = {
        slot: Number( (headerBodyCbor[1] as CborUInt ).num ),
        prev: prevHash, // prev tip hash
        txs : new Array<TxIO>( txsBodies.length ),
    };
    
    for( let tx_i = 0; tx_i < txsBodies.length; tx_i++ )
    {
        const body = txsBodies[ tx_i ];

        const hash = blake2b_256_bytes( body );
        const hashStr = hash.toString("hex");

        let tx: TxBody;
        
        try {
            tx = TxBody.fromCbor( body );
        }
        catch( e )
        {
            throw new Error(
                JSON.stringify({
                    block: hashStr,
                    tx_body: toHex( body ),
                    tx_i,
                    n_txs: txsBodies.length,
                    error: e.message,
                    stack: e.stack
                }, undefined, 1)
            );
        }

        blockInfos.txs[ tx_i ] = {
            hash: hashStr,
            ins: tx.inputs.map( i => {
                const ref = i.utxoRef.toString();
                redis.hSet( `${UTXO_PREFIX}:${ref}`, "spent", 1 ); 
                return ref;
            }),
            outs: tx.outputs.map(( out, idx ) => {
                const ref = `${hashStr}#${idx}` as TxOutRefStr;
    
                saveTxOut( out, ref );
    
                return ref;
            })
        };
    }

    await redis.json.set(
        `${BLOCK_PREFIX}:${block_hash}`,
        "$",
        blockInfos
    );
    const newLen = await redis.rPush( BLOCKS_QUEQUE_KEY, block_hash );

    if( newLen > MAX_N_VOLATILE_BLOCKS )
    {
        await removeImmutableBlock();
    }

    // notify master we finished
    parentPort?.postMessage( blockInfos );
}

async function removeImmutableBlock(): Promise<void>
{
    const redis = await getRedisClient();

    const actualLength = await redis.lLen( BLOCKS_QUEQUE_KEY );

    if( actualLength <= MAX_N_VOLATILE_BLOCKS ) return;

    const immutable_block_hash = await redis.lPop( BLOCKS_QUEQUE_KEY ) ?? "";
    const immutable_block = tryGetBlockInfos(
        await redis.json.get(
            `${BLOCK_PREFIX}:${immutable_block_hash}`
        )
    );

    if( !immutable_block ) return;

    // inputs of immutable block will never be "re-spent" again
    const ins = immutable_block.txs.map( tx => tx.ins ).flat();

    await Promise.all([
        // should we delete here?
        // the outputs are almost likely re-created on the newly swtiched fork
        // we could just update to a new status and later check if recreated
        redis.del( ins.map( ref => `${UTXO_PREFIX}:${ref}` ) ),
        Promise.all( ins.map( ref => redis.json.del(`${UTXO_VALUE_PREFIX}:${ref}`) ) )
    ]);
}