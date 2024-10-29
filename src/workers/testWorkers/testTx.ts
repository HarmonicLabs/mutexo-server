import { Address, harden, TxBuilder, Value, XPrv } from "@harmoniclabs/plu-ts";
import { BlockfrostPluts } from "@harmoniclabs/blockfrost-pluts";
import { mnemonicToEntropy } from "bip39";
import { config } from "dotenv";

config();
let senderIndex = 0;

async function triggerTx() 
{
    const xprv = XPrv.fromEntropy(
        mnemonicToEntropy( process.env.SEED_PHRASES![ senderIndex ] )
    );

    const senderAddr = Address.fromXPrv( xprv, "testnet" );

    console.log(">>> ", senderAddr.toString(), " <<<");

    const blockfrost = new BlockfrostPluts({
        projectId: process.env.BLOCKFROST_API_KEY!
    });

    const utxos = await blockfrost.addressUtxos( senderAddr );

    const receiverAddr = Address.fromString( process.env.ADDRESSES![ senderIndex === 0 ? 1 : 0 ] );

    const txBuilder = new TxBuilder(
        await blockfrost.getProtocolParameters()
    );

    const tx = txBuilder.buildSync({
        inputs: [
            { utxo: utxos[0] }
        ],
        changeAddress: senderAddr,
        outputs: [
            {
                address: receiverAddr,
                value: Value.lovelaces( 50_000_000 )
            }
        ]
    });

    const privateKey = (
        xprv
        .derive(harden(1852))
        .derive(harden(1815))
        .derive(harden(0))
        .derive(0)
        .derive(0)
    );

    tx.signWith( privateKey );

    console.log(">> ",
        JSON.stringify(
            tx.toJson(),
            undefined,
            2
        )
    , " <<");

    await blockfrost.submitTx( tx );

    console.log("> ", tx.hash.toString(), " <");

    senderIndex = senderIndex === 0 ? 1 : 0;
}

while(true)
{
    triggerTx();
    new Promise((resolve) => setTimeout(resolve, 30 * 1000));
}