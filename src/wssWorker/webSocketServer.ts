import { AddrFilter, ClientReq, ClientReqFree, ClientReqLock, ClientSub, ClientUnsub, Close, MutexoError, MutexFailure, MutexoFree, MutexoInput, MutexoLock, MutexoOutput, MutexSuccess, UtxoFilter, MutexOp, SubSuccess, clientReqFromCborObj, mutexoEventIndexToName, MutexoEventIndex } from "@harmoniclabs/mutexo-messages";
import { setWsClientIp } from "../wsServer/clientProps";
import { Address, AddressStr, forceTxOutRef, forceTxOutRefStr, TxOut, TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { fromHex } from "@harmoniclabs/uint8array-utils";
import { getClientIp as getClientIpFromReq } from "request-ip";
import { RawData, WebSocket, WebSocketServer } from "ws";
import { isObject } from "@harmoniclabs/obj-utils";
import { parentPort, workerData } from "node:worker_threads";
import { unrawData } from "../utils/unrawData";
import jwt from "jsonwebtoken";
import { URL } from "node:url";
import { addrFree, addrLock, addrOut, addrSpent, utxoFree, utxoLock, utxoSpent } from "../state/events";
import { Client } from "../wsServer/Client";
import { MutexoServerConfig } from "../MutexoServerConfig/MutexoServerConfig";
import { IMutexoInputJson, IMutexoOutputJson } from "./data";
import { MainWorkerQuery } from "./MainWorkerQuery";
import { Cbor } from "@harmoniclabs/cbor";
import { MutexEventInfos } from "../wsServer/MutexEventInfos";
import { logger } from "../utils/Logger";

const verify = jwt.verify;

const cfg = workerData.cfg as MutexoServerConfig;
const cfgAddrs = new Set( cfg.addrs );
const port = workerData.port as number;

logger.setLogLevel( cfg.logLevel );
logger.useColors( !cfg.disableLogColors )

function isFollowingAddr( addr: AddressStr ): boolean
{
    return cfgAddrs.has( addr );
}

// close message
const closeMsg = new Close().toCbor().toBuffer();
// error messages
const missingIpMsg = new MutexoError({ errorCode: 1 }).toCbor().toBuffer();
const missingAuthTokenMsg = new MutexoError({ errorCode: 2 }).toCbor().toBuffer();
const invalidAuthTokenMsg = new MutexoError({ errorCode: 2 }).toCbor().toBuffer();
const tooManyReqsMsg = new MutexoError({ errorCode: 3 }).toCbor().toBuffer();
const addrNotFollowedMsg = new MutexoError({ errorCode: 4 }).toCbor().toBuffer();
const addrAlreadyFollowedMsg = new MutexoError({ errorCode: 4 }).toCbor().toBuffer();
const utxoNotFoundMsg = new MutexoError({ errorCode: 5 }).toCbor().toBuffer();
const unknownSubEvtByAddrMsg = new MutexoError({ errorCode: 6 }).toCbor().toBuffer();
const unknownSubEvtByUTxORefMsg = new MutexoError({ errorCode: 7 }).toCbor().toBuffer();
const unknownUnsubEvtByAddrMsg = new MutexoError({ errorCode: 8 }).toCbor().toBuffer();
const unknownUnsubEvtByUTxORefMsg = new MutexoError({ errorCode: 9 }).toCbor().toBuffer();
const unknownUnsubEvtMsg = new MutexoError({ errorCode: 10 }).toCbor().toBuffer();
const unknownSubFilter = new MutexoError({ errorCode: 11 }).toCbor().toBuffer();

const maxPayload = 512;

const wsServer = new WebSocketServer({ path: "/events", maxPayload, port });
logger.info(
    "WebSocket server listening at ws://localhost:" + port + "/events",
);

const pingInterval = setInterval(
    () => {
        const clients = wsServer.clients;
        for(const client of clients) 
        {
            if( !isAlive( client ) )
            {
                client.send( closeMsg );
                terminateClient( Client.fromWs( client ) );
                return;
            }

            ( client as any ).isAlive = false;
            client.ping();
        }
    },
    30_000
);

const mainWorker = new MainWorkerQuery( parentPort );

async function getAddrOfRef( ref: TxOutRefStr ): Promise<AddressStr | undefined> 
{
    const [{ out: bytes }] = await mainWorker.resolveUtxos([ref]);
    if( !bytes ) return undefined;
    return TxOut.fromCbor(bytes).address.toString();
}

function terminateAll()
{
    const clients = wsServer.clients;
    for(const client of clients)
    {
        client.send( closeMsg );
        terminateClient( Client.fromWs( client ) );
    }
}

process.on("beforeExit", terminateAll);
wsServer.on("error", console.error);
wsServer.on("close", terminateAll);

wsServer.on("connection", async ( ws, req ) => {
    const ip = getClientIpFromReq( req );
    if( !ip ) 
    {
        ws.send( missingIpMsg );
        terminateClient( Client.fromWs( ws ) );
        return;
    }

    logger.debug("client connection from", ip);

    const url = new URL(req.url ?? "", "ws://" + req.headers.host + "/");
    const token = url.searchParams.get("token");

    if( !token ) 
    {
        ws.send( missingAuthTokenMsg );
        terminateClient( Client.fromWs( ws ) );
        return;
    }

    const validationInfos = await mainWorker.getAuthValidationInfosByToken( token );
    if( !validationInfos )
    {
        ws.send( invalidAuthTokenMsg );
        terminateClient( Client.fromWs( ws ) );
        return;
    }

    if( validationInfos.wsServerPort !== port || url.port !== port.toString() )
    {
        ws.send( invalidAuthTokenMsg );
        terminateClient( Client.fromWs( ws ) );
        return;
    }
    
    let stuff: any
    try 
    {
        stuff = verify( token, Buffer.from( validationInfos.secret ) );
    } 
    catch 
    {
        ws.send( invalidAuthTokenMsg );
        terminateClient( Client.fromWs( ws ) );
        return;
    }

    // sets `MUTEXO_CLIENT_INSTANCE` on ws
    const client = Client.fromWs( ws );

    setWsClientIp( ws, ip );
    mainWorker.incrementLeakingBucket( ip );

    // heartbeat
    ( ws as any ).isAlive = true;

    ws.on("error", console.error);
    ws.on("pong", heartbeat);
    ws.on("ping", function handleClientPing( this: WebSocket ) { this.pong(); });
    ws.on("message", handleClientMessage.bind( ws ));
});

wsServer.on("close", () => {    
    clearInterval( pingInterval )
});

parentPort?.on("message", async ( msg ) => {
    if( !isObject( msg ) ) return;
    if( msg.type === "queryResult" )
    {
        mainWorker.dispatchEvent( msg.data );
        return;
    }
    if( msg.type === "input" )
    {
        const data = msg.data as IMutexoInputJson;

        const evt = new MutexoInput({
            utxoRef: forceTxOutRef( data.ref ),
            addr: Address.fromString( data.addr ),
            txHash: fromHex( data.txHash )
        }).toCbor().toBuffer();

        utxoSpent.emitToKey( data.ref, evt );
        addrSpent.emitToKey( data.addr, evt );
        return;
    }
    if( msg.type === "output" )
    {
        const data = msg.data as IMutexoOutputJson;

        const evt = new MutexoOutput({
            utxoRef: forceTxOutRef( data.ref ),
            addr: Address.fromString( data.addr )
        }).toCbor().toBuffer();

        addrOut.emitToKey( data.addr, evt );
        return;
    }
    if( msg.type === "lock" )
    {
        const mutexInfos = msg.data as MutexEventInfos[];
        emitUtxoLockEvts( mutexInfos );
        return;
    }
    if( msg.type === "free" )
    {
        const mutexInfos = msg.data as MutexEventInfos[];
        emitUtxoUtxoFreeEvts( mutexInfos );
        return;
    }
});

function unsubAll(client: Client) {
    // mutex.unsubClient( client );
    utxoFree.unsubClient( client );
    utxoLock.unsubClient( client );
    utxoSpent.unsubClient( client );
    addrFree.unsubClient( client );
    addrLock.unsubClient( client );
    addrSpent.unsubClient( client );
    addrOut.unsubClient( client );
}

async function terminateClient( client: Client ) 
{
    unsubAll( client );

    client.terminate();
    delete (client.ws as any).MUTEXO_CLIENT_INSTANCE;
}

/**
 * - sub
 * - unsub
 * - lock
 * - free
 */
async function handleClientMessage( this: WebSocket, data: RawData ): Promise<void>
{
    const ws = this;
    const client = Client.fromWs( ws );
    // heartbeat
    ( ws as any ).isAlive = true;

    if(!(await mainWorker.incrementLeakingBucket( client.ip ))) 
    {
        client.send( tooManyReqsMsg );
        return;
    }

    const bytes = unrawData( data );
    // NO big messages
    if( bytes.length > maxPayload ) return;

    const req: ClientReq = clientReqFromCborObj( Cbor.parse( bytes ) );

    if      ( req instanceof Close )            return terminateClient( client );
    else if ( req instanceof ClientSub )        return handleClientSub( client, req );
    else if ( req instanceof ClientUnsub )      return handleClientUnsub( client, req );
    else if ( req instanceof ClientReqFree )    return handleClientReqFree( client, req );
    else if ( req instanceof ClientReqLock )    return handleClientReqLock( client, req );

    return;
}

async function handleClientSub( client: Client, req: ClientSub ): Promise<void> 
{        
    const { id, chainEventIndex, filters } = req;

    for( const filter of filters ) 
    {
        if( filter instanceof AddrFilter ) 
        {
            const addrStr = filter.addr.toString();
            const isFollowing = isFollowingAddr( addrStr );

            if( !isFollowing ) 
            {
                client.send( addrNotFollowedMsg );
                return;
            }

            switch( chainEventIndex ) 
            {
                case MutexoEventIndex.lock: {
                    addrLock.sub( addrStr, client );
                    break;
                }
                case MutexoEventIndex.free: {
                    addrFree.sub( addrStr, client );
                    break;
                }
                case MutexoEventIndex.input: {
                    addrSpent.sub( addrStr, client );
                    break;
                }
                case MutexoEventIndex.output: {
                    addrOut.sub( addrStr, client );
                    break;
                }
                default: {                    
                    // chainEventIndex; // never    
                    client.send( unknownSubEvtByAddrMsg );
                    return;
                }
            }
        }
        else if( filter instanceof UtxoFilter ) 
        {
            const ref = filter.utxoRef.toString();

            const addr = await getAddrOfRef( ref )
                                
            if( !addr || !isFollowingAddr( addr ) ) 
            {
                client.send( utxoNotFoundMsg );
                return;
            }

            switch( chainEventIndex ) 
            {
                case MutexoEventIndex.lock: {
                    utxoLock.sub( ref, client );
                    break;
                }
                case MutexoEventIndex.free: {
                    utxoFree.sub( ref, client );
                    break;
                }
                case MutexoEventIndex.input: {
                    utxoSpent.sub( ref, client );
                    break;
                }
                case MutexoEventIndex.output:
                default:
                    // chainEventIndex; // output (cannot subscribe by ref)
                    client.send( unknownSubEvtByUTxORefMsg );
                    return;
            }
        }
        else
        {
            client.send( unknownSubFilter );
            return;
        }
    }

    client.send(
        new SubSuccess({ id }).toCbor().toBuffer()
    );
    return;
}

async function handleClientUnsub( client: Client, req: ClientUnsub ): Promise<void> 
{
    const { id, chainEventIndex, filters } = req;

    for( const filter of filters )
    {
        if( filter instanceof AddrFilter ) 
        {
            const addrStr = filter.addr.toString();
            const isFollowing = isFollowingAddr( addrStr );

            if( !isFollowing ) 
            {
                client.send( addrNotFollowedMsg );
                return;
            }

            switch( chainEventIndex ) 
            {
                case MutexoEventIndex.free:
                    addrLock.sub( addrStr, client );
                    break;
                case MutexoEventIndex.lock:
                    addrFree.sub( addrStr, client );
                    break;
                case MutexoEventIndex.input:
                    addrSpent.sub( addrStr, client );
                    break;
                case MutexoEventIndex.output:
                    addrOut.sub( addrStr, client );
                    break;
                default:
                    // chainEventIndex; // never
                    client.send( unknownUnsubEvtByAddrMsg );
                    return;
            }
        }
        else if( filter instanceof UtxoFilter ) 
        {
            const ref = filter.utxoRef.toString();

            const addr = await getAddrOfRef( ref )
                                            
            if( !addr || !isFollowingAddr( addr ) ) 
            {
                client.send( utxoNotFoundMsg );
                return;
            }

            switch( chainEventIndex ) 
            {
                case MutexoEventIndex.lock:
                    utxoLock.unsub( ref, client );
                    break;
                case MutexoEventIndex.free:
                    utxoFree.unsub( ref, client );
                    break;
                case MutexoEventIndex.input:
                    utxoSpent.unsub( ref, client );
                    break;
                case MutexoEventIndex.output:
                default:
                    // chainEventIndex; // output (cannot subscribe by ref)
                    client.send( unknownUnsubEvtByUTxORefMsg );
                    return;
            }
        }
        else
        {
            client.send( unknownSubFilter );
            return;
        }
    }

    client.send(
        new SubSuccess({ id }).toCbor().toBuffer()
    );
    return;
}

async function handleClientReqLock( client: Client, req: ClientReqLock ): Promise<void> 
{
    const { id, utxoRefs } = req;

    let required = req.required;
    required = Math.max( 1, required );
    required = required >>> 0;

    const lockerInfo = { clientIp: client.ip, serverPort: port };

    const locked = await mainWorker.lock(
        lockerInfo,
        utxoRefs.map( forceTxOutRefStr ),
        required
    );

    if( locked.length < required )
    {
        // the main worker should either unlock all or none
        // so it should never be the case that we have less than required but some are locked
        // so `locked.length` should always be 0 (hence this check is redundant)
        // however, we keep it here just in case I messed up
        // so we avoid unwanted deadlocks
        if( locked.length > 0 )
        {
            mainWorker.unlock( lockerInfo, locked );
        }

        const msg = new MutexFailure({
            id,
            mutexOp: MutexOp.MutexoLock,
            utxoRefs: [] // utxoRefs.map( forceTxOutRef ),
        }).toCbor().toBuffer();

        client.send(msg);
        return;
    }
    // else

    const msg = new MutexSuccess({
        id,
        mutexOp: MutexOp.MutexoLock,
        utxoRefs: locked.map( forceTxOutRef ),
    }).toCbor().toBuffer();

    client.send(msg);
    return;

    // main worker will tell us if we need to emit the event
    // so there is no need to do it here
    // emitUtxoLockEvts( locked );
}

async function handleClientReqFree( client: Client, req: ClientReqFree ): Promise<void> 
{
    const { id, utxoRefs } = req;

    let freed: TxOutRefStr[] = [];

    // only send unlock request if there is actually something to unlock
    if( utxoRefs.length > 0 )
    {
        const lockerInfo = { clientIp: client.ip, serverPort: port };
    
        freed = await mainWorker.unlock( lockerInfo, utxoRefs.map( forceTxOutRefStr ) );
    }

    // 0 free is a failure
    if( freed.length <= 0 ) 
    {        
        const msg = new MutexFailure({
            id,
            mutexOp: MutexOp.MutexoFree,
            utxoRefs: utxoRefs.map(( ref ) => forceTxOutRef( ref )),
        }).toCbor().toBuffer();

        client.send( msg );
        return;
    }

    const msg = new MutexSuccess({
        id,
        mutexOp: MutexOp.MutexoFree,
        utxoRefs: freed.map( forceTxOutRef ),
    }).toCbor().toBuffer();

    client.send( msg );
    return;

    // main worker will tell us if we need to emit the event
    // so there is no need to do it here
    // emitUtxoUtxoFreeEvts( freed );
}

async function emitUtxoLockEvts( datas: MutexEventInfos[]): Promise<void>
{
    for (const { ref, addr } of datas) {
        const msg = new MutexoLock({
            utxoRef: forceTxOutRef( ref ),
            addr: Address.fromString( addr )
        }).toCbor().toBuffer();

        utxoLock.emitToKey( ref, msg );
        addrLock.emitToKey( addr, msg );
    }
}

async function emitUtxoUtxoFreeEvts( datas: MutexEventInfos[] ): Promise<void>
{
    for (const { ref, addr } of datas) {
        const msg = new MutexoFree({
            utxoRef: forceTxOutRef( ref ),
            addr: Address.fromString( addr )
        }).toCbor().toBuffer();

        utxoFree.emitToKey( ref, msg );
        addrFree.emitToKey( addr, msg );
    }
}

function heartbeat(this: WebSocket) {
    ( this as any ).isAlive = true;
}

function isAlive(thing: any): boolean {
    return thing?.isAlive === true;
}
