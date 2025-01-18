import { ChainSyncClient, LocalStateQueryClient, Multiplexer } from "@harmoniclabs/ouroboros-miniprotocols-ts";
import { Cbor, CborArray, CborBytes, CborObj, CborTag, CborUInt, LazyCborArray, LazyCborObj } from "@harmoniclabs/cbor";
import { Address, AddressStr, TxBody, TxOut, TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { syncAndAcquire } from "./funcs/syncAndAcquire";
import { toHex } from "@harmoniclabs/uint8array-utils";
import { filterInplace } from "./utils/filterInplace";
import { isObject } from "@harmoniclabs/obj-utils";
import { isAddrStr } from "./utils/isAddrStr";
import { Worker } from "node:worker_threads";
import { connect } from "net";
import { MutexoServerConfig } from "./MutexoServerConfig/MutexoServerConfig";
import { Chain } from "./state/data/Chain";
import { createHash } from "blake2";
import { BlockInfos, TxIO } from "./types/BlockInfos";
import { IMutexoInputJson, IMutexoOutputJson } from "./wss/data";
import express from "express";
import { wsAuthIpRateLimit } from "./middlewares/ip";
import { getClientIp as getClientIpFromReq } from "request-ip";
import { logger } from "./utils/Logger";
import { isQueryMessageName } from "./wss/MainWorkerQuery";
import { AppState } from "./state/AppState";


export async function main( cfg: MutexoServerConfig )
{
    const webSocketServer = new Worker(__dirname + "/wss/webSocketServer.js", { workerData: cfg });
    
    const app = express();
    app.use( express.json() );
    app.set("trust proxy", 1);

    const state = new AppState();

    app.get("/wsAuth", wsAuthIpRateLimit, async ( req, res ) => {
        const ip = getClientIpFromReq( req );
        if(typeof ip !== "string")
        {
            res.status(500).send("invalid ip");
            return;
        }  

        const tokenStr = state.getNewAuthToken( ip );

        res.status(200).send( tokenStr );
    });

    app.listen( cfg.port, () => {
        logger.info(`Mutexo server listening at http://localhost:${cfg.port}`);
    });

    process.on("beforeExit", () => {
        webSocketServer.terminate();
    });

    const mplexer = new Multiplexer({
        connect: () => connect({ path: process.env.CARDANO_NODE_SOCKET_PATH ?? "" }),
        protocolType: "node-to-client"
    });

    const chainSyncClient = new ChainSyncClient( mplexer );
    const lsqClient = new LocalStateQueryClient( mplexer );

    process.on("beforeExit", () => {
		lsqClient.done();
        chainSyncClient.done();
        mplexer.close();
    });

    let tip = await syncAndAcquire( chainSyncClient, lsqClient, cfg.network );

    // await Promise.all(
    //     cfg.addrs.map( followAddr )
    // )

    webSocketServer.on("message", async ( msg ) => {
        if( !isObject( msg ) ) return;

        if( isQueryMessageName( msg.type ) )
        {
            state.handleQueryMessage( msg, webSocketServer );
            return;
        }
    })

    chainSyncClient.on("rollForward", rollForward => {
        const blockData: Uint8Array = rollForward.cborBytes ?
            rollForwardBytesToBlockData( rollForward.cborBytes, rollForward.data ) : 
            Cbor.encode( rollForward.data ).toBuffer();

        tip = rollForward.tip.point;

        saveBlockAndEmitEvents( state, blockData, webSocketServer );
    });

    chainSyncClient.on("rollBackwards", rollBack => {
        if( !rollBack.point.blockHeader ) return;
        
        tip = rollBack.tip.point;
        const hashStr = toHex( rollBack.point.blockHeader.hash );
        state.chain.revertUntilHash( hashStr );
    });

    while( true )
    {
        void await chainSyncClient.requestNext();
    }
};

function rollForwardBytesToBlockData( bytes: Uint8Array, defaultCborObj: CborObj ): Uint8Array
{
    let cbor: CborObj | LazyCborObj
    
    try 
	{
        cbor = Cbor.parse( bytes );
    }
    catch 
	{
        return Cbor.encode( defaultCborObj ).toBuffer();
    }
    
    if(!(
        cbor instanceof CborArray &&
        cbor.array[1] instanceof CborTag && 
        cbor.array[1].data instanceof CborBytes
    ))
    {
        return Cbor.encode( defaultCborObj ).toBuffer();
    }

    cbor = Cbor.parseLazy( cbor.array[1].data.buffer );

    if(!( cbor instanceof LazyCborArray ))
    {
        return Cbor.encode( defaultCborObj ).toBuffer();
    }

    return cbor.array[1];
}

function saveBlockAndEmitEvents( state: AppState, blockData: Uint8Array, wssWorker: Worker ): void
{
    const lazyBlock = Cbor.parseLazy( blockData );
    
    if(!( lazyBlock instanceof LazyCborArray ))
    {
        throw new Error("invalid CBOR for block");
    }

    const headerData = lazyBlock.array[0];

    const block_hash = black2b_256_hex( headerData );

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

    const chain = state.chain;

    const prevHash = chain.tip;

    chain.tip = block_hash;

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

        const ins: TxOutRefStr[] = [];
        for(const i of tx.inputs)
        {
            const ref = i.utxoRef.toString();
            ins.push( ref );

            const inputBytes = chain.spend( ref );
            if( !inputBytes ) continue;
            const input = TxOut.fromCbor( inputBytes );

            emitInputEvent( wssWorker, {
                addr: input.address.toString(),
                ref,
                txHash: hashStr
            });
        }

        const outs: TxOutRefStr[] = [];
        for(let i = 0; i < tx.outputs.length; i++)
        {
            const out = tx.outputs[i];
            const ref = `${hashStr}#${i}` as TxOutRefStr;
            outs.push( ref );

            chain.saveTxOut( out, ref );
            const addr = out.address.toString();

            emitOutputEvent( wssWorker, {
                addr,
                ref,
            });
        }

        blockInfos.txs[ tx_i ] = {
            // hash: hashStr,
            ins,
            outs
        };
    }
}


function black2b_256_hex( data: Uint8Array ): string
{
    return createHash("blake2b", { digestLength: 32 }).update(Buffer.from( data )).digest("hex")
}

function blake2b_256_bytes( data: Uint8Array ): Buffer
{
    return createHash("blake2b", { digestLength: 32 }).update(Buffer.from( data )).digest();
}


function emitInputEvent( wssWorker: Worker, inputData: IMutexoInputJson )
{
    wssWorker.postMessage({
        type: "input",
        data: inputData
    });
}

function emitOutputEvent( wssWorker: Worker, outputData: IMutexoOutputJson )
{
    wssWorker.postMessage({
        type: "output",
        data: outputData
    });
}