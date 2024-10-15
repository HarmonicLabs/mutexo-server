import { ChainPoint, ChainSyncClient, LocalStateQueryClient, MiniProtocol, N2CHandshakeVersion, N2CMessageAcceptVersion, N2CMessageProposeVersion, n2cHandshakeMessageFromCbor } from "@harmoniclabs/ouroboros-miniprotocols-ts";

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
    lsqClient: LocalStateQueryClient
): Promise<ChainPoint>
{
    const mplexer = chainSyncClient.mplexer;
    
    // handshake
    await new Promise<void>(( resolve => {
        mplexer.on( MiniProtocol.Handshake, chunk => {

            const msg = n2cHandshakeMessageFromCbor( chunk );

            if( msg instanceof N2CMessageAcceptVersion )
            {
                mplexer.clearListeners( MiniProtocol.Handshake );
                resolve();
            }
            else {
                console.error( msg );
                throw new Error("TODO: handle rejection")
            }
        });

        mplexer.send(
            new N2CMessageProposeVersion({
                versionTable: [
                    {
                        version: N2CHandshakeVersion.v14,
                        data: { networkMagic: 2 }
                    }
                ]
            }).toCbor().toBuffer(),
            {
                hasAgency: true,
                protocol: MiniProtocol.Handshake
            }
        );
    }));

    const tip = await sync( chainSyncClient );

    await acquire( lsqClient, tip );

    return tip;
}