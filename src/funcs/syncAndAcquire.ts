import { CardanoNetworkMagic, ChainPoint, ChainSyncClient, HandshakeAcceptVersion, HandshakeClient, IVersionData, LocalStateQueryClient, MiniProtocol } from "@harmoniclabs/ouroboros-miniprotocols-ts";

export async function sync( chainSyncClient: ChainSyncClient ): Promise<ChainPoint>
{
    // get chain tip
    const tip = await new Promise<ChainPoint>( res => {
        chainSyncClient.once("rollBackwards", rollback => {
            res( rollback.tip.point ) 
        });
        chainSyncClient.requestNext();
    });

    // sync
    await new Promise<void>( res => {
        chainSyncClient.once("intersectFound", _ => res() );
        // chainSyncClient.once("intersectNotFound", thing => { throw thing; } );
        chainSyncClient.findIntersect([ tip ]);
    });

    return tip;
}

export function acquire( lsqClient: LocalStateQueryClient, point: ChainPoint ): Promise<void>
{
    // acquire tip local chain sync
    return new Promise<void>( (resolve, reject) => {

        function handleFailure()
        {
            lsqClient.removeEventListener("acquired", resolveAcquired)
            reject();
        }

        function resolveAcquired()
        {
            lsqClient.removeEventListener("failure", handleFailure);
            resolve();
        }

        lsqClient.once("failure", handleFailure);
        lsqClient.once("acquired", resolveAcquired);

        lsqClient.acquire( point );
    });
}

export async function syncAndAcquire(
    chainSyncClient: ChainSyncClient,
    lsqClient: LocalStateQueryClient,
    networkMagic: number
): Promise<ChainPoint>
{
    const mplexer = chainSyncClient.mplexer;
    
    // handshake
    const handshakeResult = (
        await new HandshakeClient( mplexer )
        .propose({
            networkMagic,
            query: false
        })
    );
    if(!( handshakeResult instanceof HandshakeAcceptVersion )) throw new Error("Handshake failed");

    const tip = await sync( chainSyncClient );

    await acquire( lsqClient, tip );

    return tip;
}