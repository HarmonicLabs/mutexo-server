import { AddrFilter, ClientReq, ClientReqFree, ClientReqLock, ClientSub, ClientUnsub, Close, MutexoError, MutexFailure, MutexoFree, MutexoInput, MutexoLock, MutexoOutput, MutexSuccess, UtxoFilter, MutexOp, SubSuccess } from "@harmoniclabs/mutexo-messages";
import { getClientUtxoSpentSubs, getClientAddrSpentSubs, getClientOutputsSubs, setWsClientIp, getWsClientIp, getClientUtxoFreeSubs, getClientUtxoLockSubs, getClientAddrFreeSubs, getClientAddrLockSubs } from "../wsServer/clientProps";
import { LEAKING_BUCKET_BY_IP_PREFIX, LEAKING_BUCKET_MAX_CAPACITY, LEAKING_BUCKET_TIME, TEMP_AUTH_TOKEN_PREFIX, UTXO_PREFIX } from "../constants";
import { Address, AddressStr, forceTxOutRef, forceTxOutRefStr, TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { parseClientReq } from "@harmoniclabs/mutexo-messages/dist/utils/parsers";
import { eventIndexToMutexoEventName } from "../utils/mutexEvents";
import { fromHex, toHex } from "@harmoniclabs/uint8array-utils";
import { getClientIp as getClientIpFromReq } from "request-ip";
import { isFollowingAddr } from "../redis/isFollowingAddr";
import { getRedisClient } from "../redis/getRedisClient";
import { RawData, WebSocket, WebSocketServer } from "ws";
import { tryGetBlockInfos } from "../types/BlockInfos";
import { MutexoServerEvent } from "../wsServer/events";
import { isObject } from "@harmoniclabs/obj-utils";
import { Logger, LogLevel } from "../utils/Logger";
import { parentPort, workerData } from "node:worker_threads";
import { ipRateLimit } from "../middlewares/ip";
import { unrawData } from "../utils/unrawData";
import { sign, verify } from "jsonwebtoken";
import { webcrypto } from "node:crypto";
import { URL } from "node:url";
import express from "express";
import http from "http";
import { setupWorker } from "../setupWorker";
import { addrFree, addrLock, addrOut, addrSpent, utxoFree, utxoLock, utxoSpent } from "../wsServer/state/events";
import { Client } from "../wsServer/Client";
import { Mutex } from "../wsServer/state/mutex/mutex";

setupWorker( workerData );

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

const logger = new Logger({ logLevel: LogLevel.DEBUG });

const app = express();
app.use( express.json() );
app.set("trust proxy", 1);

const http_server = http.createServer( app );

const wsServer = new WebSocketServer({ server: http_server, path: "/events", maxPayload: 512 });

const pendingBucketsDecrements: Map<() => void, NodeJS.Timeout> = new Map();

async function leakingBucketOp( client: WebSocket ): Promise<number> 
{
    const ip = getWsClientIp( client );
    const redis = getRedisClient();
    const incr = await redis.incr(`${LEAKING_BUCKET_BY_IP_PREFIX}:${ip}`);

    let timeout: NodeJS.Timeout;
    function cb() 
    {
        pendingBucketsDecrements.delete(cb);
        if( timeout ) clearTimeout( timeout );
        redis.decr(`${LEAKING_BUCKET_BY_IP_PREFIX}:${ip}`);
    };

    timeout = setTimeout(cb, LEAKING_BUCKET_TIME);
    pendingBucketsDecrements.set(cb, timeout);
    return incr;
}

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

function terminateAll()
{
    for( const [cb, timeout] of pendingBucketsDecrements )
    {
        clearTimeout( timeout );
        cb();
    }
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

    const url = new URL(req.url ?? "", "ws://" + req.headers.host + "/");
    const token = url.searchParams.get("token");

    if( !token ) 
    {
        ws.send( missingAuthTokenMsg );
        terminateClient( Client.fromWs( ws ) );
        return;
    }

    const redis = getRedisClient();
    const infos = await redis.hGetAll(`${TEMP_AUTH_TOKEN_PREFIX}:${token}`);

    if( !infos ) 
    {
        ws.send( invalidAuthTokenMsg );
        terminateClient( Client.fromWs( ws ) );
        return;
    }

    const { secretHex } = infos;

    let stuff: any
    try 
    {
        stuff = verify( token, Buffer.from( secretHex, "hex" ) );
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
    leakingBucketOp( ws );

    ( ws as any ).isAlive = true;

    ws.on("error", console.error);
    ws.on("pong", heartbeat);
    ws.on("ping", function handleClientPing( this: WebSocket ) { this.pong(); });
    ws.on("message", handleClientMessage.bind( ws ));
});

wsServer.on("close", () => {    
    clearInterval( pingInterval )
});

// HTTP SERVER

app.get("/wsAuth", ipRateLimit, async ( req, res ) => {
    const redis = getRedisClient();
    let secretBytes = new Uint8Array(32);
    const ip = getClientIpFromReq( req );
    let tokenStr: string;

    do 
    {
        webcrypto.getRandomValues( secretBytes );
        tokenStr = sign(
            { ip },
            Buffer.from( secretBytes ),
            { expiresIn: 30 }
        );
    }
    while( await redis.exists(`${TEMP_AUTH_TOKEN_PREFIX}:${tokenStr}`) );

    const key = `${TEMP_AUTH_TOKEN_PREFIX}:${tokenStr}`;

    const secretHex = toHex( secretBytes );

    await redis.hSet( key, { secretHex } );
    await redis.expire( key, 30 );

    res.status(200).send( tokenStr );
});

http_server.listen((3001), () => {    
    logger.info("Server listening on port 3001");
});

parentPort?.on("message", async ( msg ) => {
    if( !isObject( msg ) ) return;
    if( msg.type === "Block" ) 
    {
        const blockInfos = tryGetBlockInfos( msg.data );

        if( !blockInfos ) return;

        const redis = getRedisClient();
        const txs = blockInfos.txs;

        for( const { ins, outs } of txs ) 
        {
            const txHash = outs[0].split("#")[0];

            await Promise.all([
                Promise.all(
                    ins.map( async inp => {                                                
                        const addr = await redis.hGet(`${UTXO_PREFIX}:${inp}`, "addr") as AddressStr | undefined;
                                              
                        if( !addr ) return;

                        const msg = new MutexoInput({
                            utxoRef: forceTxOutRef( inp ),
                            addr: Address.fromString( addr ),
                            txHash: fromHex( txHash )
                        }).toCbor().toBuffer();

                        utxoSpent.emitToKey( inp, msg );
                        addrSpent.emitToKey( addr, msg );
                    })
                ),
                Promise.all(
                    outs.map( async out => {
                        const addr = await redis.hGet(`${UTXO_PREFIX}:${out}`, "addr") as AddressStr | undefined;
                                                                        
                        if( !addr ) return;

                        const msg = new MutexoOutput({
                            utxoRef: forceTxOutRef( out ),
                            addr: Address.fromString( addr )
                        }).toCbor().toBuffer();

                        addrOut.emitToKey( addr, msg );
                    })
                )
            ]);
        }
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

    // -- super duper iper illegal --
    // (test purposes only)
    // const ip = getWsClientIp( client );
    // const redis = getRedisClient();
    // redis.del(`${LEAKING_BUCKET_BY_IP_PREFIX}:${ip}`);
    // ------------------------------

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
    const client = this;
    // heartbeat
    ( client as any ).isAlive = true;
    const reqsInLastMinute = await leakingBucketOp( client );

    if( reqsInLastMinute > LEAKING_BUCKET_MAX_CAPACITY ) 
    {
        client.send( tooManyReqsMsg );
        return;
    }

    const bytes = unrawData( data );
    // NO big messages
    if( bytes.length > 512 ) return;

    const req: ClientReq = parseClientReq( bytes );

    if      ( req instanceof Close )         return terminateClient( Client.fromWs( client ) );
    else if ( req instanceof ClientSub )            return handleClientSub( Client.fromWs( client ), req );
    else if ( req instanceof ClientUnsub )          return handleClientUnsub( Client.fromWs( client ), req );
    else if ( req instanceof ClientReqFree )        return handleClientReqFree( Client.fromWs( client ), req );
    else if ( req instanceof ClientReqLock )        return handleClientReqLock( Client.fromWs( client ), req );

    return;
}

async function handleClientSub( client: Client, req: ClientSub ): Promise<void> 
{        
    const { id, eventType, filters } = req;

    for( const filter of filters ) 
    {
        const evtName = eventIndexToMutexoEventName( eventType );

        if( filter instanceof AddrFilter ) 
        {
            const addrStr = filter.addr.toString();
            const isFollowing = await isFollowingAddr( addrStr );

            if( !isFollowing ) 
            {
                client.send( addrNotFollowedMsg );
                return;
            }

            switch( evtName ) 
            {
                case MutexoServerEvent.Lock: {
                    addrLock.sub( addrStr, client );
                    break;
                }
                case MutexoServerEvent.Free: {
                    addrFree.sub( addrStr, client );
                    break;
                }
                case MutexoServerEvent.Input: {
                    addrSpent.sub( addrStr, client );
                    break;
                }
                case MutexoServerEvent.Output: {
                    addrOut.sub( addrStr, client );
                    break;
                }
                default: {                        
                    client.send( unknownSubEvtByAddrMsg );
                    return;
                }
            }
        }
        else if( filter instanceof UtxoFilter ) 
        {
            const ref = filter.utxoRef.toString();
            const redis = getRedisClient();
            const addr = await redis.hGet(`${UTXO_PREFIX}:${ref}`, "addr") as AddressStr | undefined;
                                
            if( !addr || !await isFollowingAddr( addr ) ) 
            {
                client.send( utxoNotFoundMsg );
                return;
            }

            switch( evtName ) 
            {
                case MutexoServerEvent.Lock:
                    utxoLock.sub( ref, client );
                    break;
                case MutexoServerEvent.Free:
                    utxoFree.sub( ref, client );
                    break;
                case MutexoServerEvent.Input:
                    utxoSpent.sub( ref, client );
                    break;
                case MutexoServerEvent.Output:
                default:
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
    const { id, eventType, filters } = req;

    for( const filter of filters )
    {
        const evtName = eventIndexToMutexoEventName(eventType);

        if( filter instanceof AddrFilter ) 
        {
            const addrStr = filter.addr.toString();
            const isFollowing = await isFollowingAddr( addrStr );

            if( !isFollowing ) 
            {
                client.send( addrNotFollowedMsg );
                return;
            }

            switch( evtName ) 
            {
                case MutexoServerEvent.Free:
                    addrLock.sub( addrStr, client );
                    break;
                case MutexoServerEvent.Lock:
                    addrFree.sub( addrStr, client );
                    break;
                case MutexoServerEvent.Input:
                    addrSpent.sub( addrStr, client );
                    break;
                case MutexoServerEvent.Output:
                    addrOut.sub( addrStr, client );
                    break;
                default:
                    client.send( unknownUnsubEvtByAddrMsg );
                    return;
            }
        }
        else if( filter instanceof UtxoFilter ) 
        {
            const ref = filter.utxoRef.toString();
            const redis = getRedisClient();

            const addr = await redis.hGet(`${UTXO_PREFIX}:${ref}`, "addr") as AddressStr | undefined;
                                            
            if( !addr || !await isFollowingAddr( addr ) ) 
            {
                client.send( utxoNotFoundMsg );
                return;
            }

            switch( evtName ) 
            {
                case MutexoServerEvent.Lock:
                    utxoLock.unsub( ref, client );
                    break;
                case MutexoServerEvent.Free:
                    utxoFree.unsub( ref, client );
                    break;
                case MutexoServerEvent.Input:
                    utxoSpent.unsub( ref, client );
                    break;
                case MutexoServerEvent.Output:
                default:
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

async function handleClientReqLock( client: Client, req: ClientReqLock ): Promise<void> 
{
    const { id, utxoRefs, required } = req;

    let nLocked = 0
    const locked = (
        utxoRefs.map( forceTxOutRefStr )
        .filter((utxoRef) => {
            if( nLocked >= required ) return false;
            const result = Mutex.lock(utxoRef, client);
            if( result ) nLocked++;
            return result;
        })
    );

    if( locked.length < required )
    {
        for( const ref of locked ) Mutex.unlock( client, ref );

        const msg = new MutexFailure({
            id,
            mutexOp: MutexOp.MutexoLock,
            utxoRefs: locked.map( forceTxOutRef ),
        }).toCbor().toBuffer();

        client.send(msg);
        return;
    }

    emitUtxoLockEvts( locked );
}

async function emitUtxoLockEvts(refs: TxOutRefStr[]): Promise<void> {
    const redis = getRedisClient();

    const datas = await Promise.all(
        refs.map(async ref => {
            const addr = await redis.hGet(`${UTXO_PREFIX}:${ref}`, "addr")! as AddressStr;
            return { ref, addr }
        })
    );

    for (const data of datas) {
        const msg = new MutexoLock({
            utxoRef: forceTxOutRef(data.ref),
            addr: Address.fromString(data.addr)
        }).toCbor().toBuffer();

        utxoLock.emitToKey(data.ref, msg);
        addrLock.emitToKey(data.addr, msg);
    }
}

async function handleClientReqFree( client: Client, req: ClientReqFree ): Promise<void> 
{
    const { id, utxoRefs } = req;

    const freed = (
        utxoRefs.map( forceTxOutRefStr )
        .filter( ref => Mutex.isCurrentLocker( client, ref ) )
    );

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

    for( const ref of freed ) Mutex.unlock( client, ref );

    const msg = new MutexSuccess({
        id,
        mutexOp: MutexOp.MutexoFree,
        utxoRefs: freed.map( forceTxOutRef),
    }).toCbor().toBuffer();

    client.send( msg );
    emitUtxoUtxoFreeEvts( freed );
    return;
}

async function emitUtxoUtxoFreeEvts(refs: TxOutRefStr[]): Promise<void> {
    const redis = getRedisClient();

    const datas = await Promise.all(
        refs.map(async ref => {
            const addr = await redis.hGet(`${UTXO_PREFIX}:${ref}`, "addr")! as AddressStr;
            return { ref, addr }
        })
    );

    for (const data of datas) {
        const msg = new MutexoFree({
            utxoRef: forceTxOutRef(data.ref),
            addr: Address.fromString(data.addr)
        }).toCbor().toBuffer();

        utxoFree.emitToKey(data.ref, msg);
        addrFree.emitToKey(data.addr, msg);
    }
}

function heartbeat(this: WebSocket) {
    ( this as any ).isAlive = true;
}

function isAlive(thing: any): boolean {
    return thing?.isAlive === true;
}
