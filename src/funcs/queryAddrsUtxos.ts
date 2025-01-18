import { Address, TxOut, TxOutRef, UTxO } from "@harmoniclabs/cardano-ledger-ts";
import { CborArray, CborBytes, CborMap, CborUInt } from "@harmoniclabs/cbor";
import { LocalStateQueryClient } from "@harmoniclabs/ouroboros-miniprotocols-ts";
import { lexCompare } from "@harmoniclabs/uint8array-utils";

async function queryAddrsUtxos( client: LocalStateQueryClient, addrs: Address[] ): Promise<UTxO[]>
{
    const query = new CborArray([
        new CborUInt( 0 ),
        new CborArray([
            new CborUInt( 0 ),
            new CborArray([
                new CborUInt( 5 ),
                new CborArray([
                    new CborUInt( 6 ),
                    new CborArray(
                        addrs
                        .map( addr => addr.toBuffer() )
                        .sort( lexCompare )
                        .map( b => new CborBytes( b ) )
                    )
                ])
            ])
        ])
    ]);

    const { result } = await client.query( query );

    const map = ((result as CborArray).array[0] as CborMap).map;

    return map.map(({ k, v }) =>
        new UTxO({
            utxoRef: TxOutRef.fromCborObj( k ),
            resolved: TxOut.fromCborObj( v )
        })
    );
}