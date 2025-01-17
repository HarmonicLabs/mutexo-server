
// singleton
export class VolatileBlocks
{
    private constructor() {}

    static readonly blocks: string[] = [];

    static hasBlock( hashStr: string ): boolean
    {
        // return VolatileBlocks.blocks.includes( hashStr );
        for( let i = VolatileBlocks.blocks.length - 1; i >= 0; i-- )
        {
            if( VolatileBlocks.blocks[i] === hashStr ) return true;
        }
        return false;
    }

    static revertUntilHash( hashStr: string ): string[]
    {
        const revertedBlocks: string[] = [];
        let blockHash: string;
        while( (blockHash = VolatileBlocks.blocks.pop()) !== undefined )
        {
            revertedBlocks.push( blockHash );
            if( blockHash === hashStr ) break;
        }
        return revertedBlocks;
    }
}