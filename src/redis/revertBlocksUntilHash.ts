import { BLOCKS_QUEQUE_KEY, BLOCK_PREFIX, TIP_HASH_KEY, UTXO_PREFIX, UTXO_VALUE_PREFIX } from "../constants";
import { BlockInfosWithHash, tryGetBlockInfos } from "../types/BlockInfos";
import { UTxOStatus } from "../types/UTxOWithStatus";
import { getRedisClient } from "./getRedisClient";
import { hasBlockHash } from "./hasBlockHash";

export async function revertBlocksUntilHash( hashStr: string ): Promise<BlockInfosWithHash[]>
{
    if( !await hasBlockHash( hashStr ) ) return [];

    const redis = await getRedisClient();

    let tip_hash = await redis.get( TIP_HASH_KEY ) ?? "";
    const revertedBlocks: BlockInfosWithHash[] = [];

    let blockInfos: BlockInfosWithHash | undefined = undefined;

    while( tip_hash !== hashStr )
    {
        blockInfos = tryGetBlockInfos( await redis.json.get(`${BLOCK_PREFIX}:${tip_hash}`) ) as BlockInfosWithHash;
        blockInfos.hash = tip_hash;
        
        if( !blockInfos )
        {
            throw new Error(
                "missing block with hash: " + tip_hash +
                "\nreverted blocks: "+ JSON.stringify( revertedBlocks.map( b => b.hash ) )
            );
        }

        // remove last block
        redis.json.del(`${BLOCK_PREFIX}:${tip_hash}`);
        await redis.rPop( BLOCKS_QUEQUE_KEY );
        
        revertedBlocks.push( blockInfos );

        tip_hash = blockInfos.prev;

        const txs = blockInfos.txs
        
        // from last to first transaction in block
        // to account for chained utxos
        for( let i = txs.length - 1; i >= 0; i-- )
        {
            const { ins, outs } = txs[i];
            await Promise.all([
                // should we delete here?
                // the outputs are almost likely re-created on the newly swtiched fork
                // we could just update to a new status and later check if re-created
                redis.del( outs.map( ref => `${UTXO_PREFIX}:${ref}` ) ),
                Promise.all( outs.map( ref => redis.json.del(`${UTXO_VALUE_PREFIX}:${ref}`) ) ),

                // un-spend utxo
                Promise.all( ins.map( ref => redis.hSet(`${UTXO_PREFIX}:${ref}`, "spent", 0 ) ) ),
                
                // mutex is managed in the websocket server
                // we are rolling back, so the utxo is free to be used, no matter if a user blocked it or not
                // redis.del( ins.map( ref => `${UTXO_PREFIX}:${ref}:${UTXO_LOCK_SET_POSTFIX}` ) )
            ]);
        }
    }

    // update tip hash
    await redis.set( TIP_HASH_KEY, tip_hash );

    return revertedBlocks;
}