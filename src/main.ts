import { ChainSyncClient, LocalStateQueryClient, Multiplexer } from "@harmoniclabs/ouroboros-miniprotocols-ts";
import { Cbor, CborArray, CborBytes, CborObj, CborTag, LazyCborArray, LazyCborObj } from "@harmoniclabs/cbor";
import { revertBlocksUntilHash } from "./redis/revertBlocksUntilHash";
import { Address, AddressStr } from "@harmoniclabs/cardano-ledger-ts";
import { queryAddrsUtxos } from "./funcs/queryAddrsUtxos";
import { syncAndAcquire } from "./funcs/syncAndAcquire";
import { toHex } from "@harmoniclabs/uint8array-utils";
import { filterInplace } from "./utils/filterInplace";
import { appendFileSync, mkdirSync } from "node:fs";
import { isObject } from "@harmoniclabs/obj-utils";
import { saveUtxos } from "./funcs/saveUtxos";
import { isAddrStr } from "./utils/isAddrStr";
import { Worker } from "node:worker_threads";
import { connect } from "net";
import { MutexoServerConfig } from "./MutexoServerConfig/MutexoServerConfig";

export async function main( cfg: MutexoServerConfig)
{
    const webSocketServer = new Worker(__dirname + "/workers/webSocketServer.js", { workerData: cfg });
    const blockParser = new Worker(__dirname + "/workers/blockParser.js", { workerData: cfg });

    process.on("beforeExit", () => {
        webSocketServer.terminate();
        blockParser.terminate();
    });

    // block parser only notifies that it finished parsing a block
    // all new data is in redis
    blockParser.on("message", ( blockInfos ) => {
        webSocketServer.postMessage({
            type: "Block",
            data: blockInfos
        });
    });

    blockParser.on("error", ( err ) => {
        mkdirSync("./logs", { recursive: true });
        appendFileSync("./logs/blockParserErrors.log", `[${new Date().toString()}][BLOCK PARSER ERROR]: ` + err + "\n");
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

    let tip = await syncAndAcquire( chainSyncClient, lsqClient );

    webSocketServer.on("message", async ( msg ) => {
        if( !isObject( msg ) ) return;
        if( msg.type === "queryAddrsUtxos" )
        {
            if( !Array.isArray( msg.data ) ) return;
            
            let addrs = msg.data as AddressStr[];
            filterInplace( addrs, isAddrStr );

            if( addrs.length === 0 ) return;

            await lsqClient.acquire( tip );
            await saveUtxos(
                await queryAddrsUtxos(
                    lsqClient, 
                    addrs.map( addr => Address.fromString( addr ) )
                )
            );
        }
    })

    chainSyncClient.on("rollForward", rollForward => {
        const blockData: Uint8Array = rollForward.cborBytes ?
            rollForwardBytesToBlockData( rollForward.cborBytes, rollForward.blockData ) : 
            Cbor.encode( rollForward.blockData ).toBuffer();

        tip = rollForward.tip.point;

        blockParser.postMessage( blockData );
    });

    chainSyncClient.on("rollBackwards", rollBack => {
        if( !rollBack.point.blockHeader ) return;
        
        tip = rollBack.tip.point;
        const hashStr = toHex( rollBack.point.blockHeader.hash );
        revertBlocksUntilHash( hashStr ).then( revertedBlocks => {});
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