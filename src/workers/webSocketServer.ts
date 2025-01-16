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
import { utxoFreeSubs } from "../wsServer/state/utxoFreeEvt/utxoFreeSubs";
import { isBlockingUTxO } from "../wsServer/state/lock/isBlockingUtxo";
import { unlockUTxO } from "../wsServer/state/lock/unlockUtxo";
import { subUtxoFreeEvt } from "../wsServer/state/utxoFreeEvt/subUtxoFreeEvt";
import { utxoLockSubs } from "../wsServer/state/lockEvt/utxoLockSubs";
import { get } from "node:http";
import { addrFree, addrLock, addrOut, addrSpent } from "../wsServer/state/events";
import { Client } from "../wsServer/Client";

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
                terminateClient(client);
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
        terminateClient(client);
    }
}

process.on("beforeExit", terminateAll);
wsServer.on("error", console.error);
wsServer.on("close", terminateAll);

wsServer.on("connection", async ( client, req ) => {
    const ip = getClientIpFromReq( req );
    if( !ip ) 
    {
        client.send( missingIpMsg );
        terminateClient( client );
        return;
    }

    const url = new URL(req.url ?? "", "ws://" + req.headers.host + "/");
    const token = url.searchParams.get("token");

    if( !token ) 
    {
        client.send( missingAuthTokenMsg );
        terminateClient( client );
        return;
    }

    const redis = getRedisClient();
    const infos = await redis.hGetAll(`${TEMP_AUTH_TOKEN_PREFIX}:${token}`);

    if( !infos ) 
    {
        client.send( invalidAuthTokenMsg );
        terminateClient( client );
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
        client.send( invalidAuthTokenMsg );
        terminateClient( client );
        return;
    }

    setWsClientIp( client, ip );
    leakingBucketOp( client );

    ( client as any ).isAlive = true;

    client.on("error", console.error);
    client.on("pong", heartbeat);
    client.on("ping", function handleClientPing( this: WebSocket ) { this.pong(); });
    client.on("message", handleClientMessage.bind( client ));
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
    logger.debug("!- THE SERVER IS LISTENING ON PORT 3001 -!")
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

                        utxoSpentClients.get( inp )?.forEach(( client ) => client.send( msg ));
                        addrSpentClients.get( addr )?.forEach(( client ) => client.send( msg ));
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

                        outputClients.get( addr )?.forEach(( client ) => client.send( msg ));
                    })
                )
            ]);
        }
    }
});

function unsubAll(client: WebSocket) {
    unsubAllOutput(client);
    unsubAllSpentUTxO(client);
    unsubAllSpentAddr(client);
    unsubAllFreeUTxO(client);
    unsubAllLockedUTxO(client);
    unsubAllFreeAddr(client);
    unsubAllLockedAddr(client);
}

async function terminateClient( client: WebSocket ) 
{
    unsubAll( client );

    // -- super duper iper illegal --
    // (test purposes only)
    const ip = getWsClientIp( client );
    const redis = getRedisClient();
    redis.del(`${LEAKING_BUCKET_BY_IP_PREFIX}:${ip}`);
    // ------------------------------

    client.terminate();
    delete (client as any).MUTEXO_CLIENT_INSTANCE;
}

/**
 * - sub
 * - unsub
 * - lock
 * - free
 */
async function handleClientMessage( this: WebSocket, data: RawData ): Promise<void>
{
    logger.debug("!- HANDLING MUTEXO CLIENT MESSAGE -!");
        
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

    if      ( req instanceof Close )         return terminateClient( client );
    else if ( req instanceof ClientSub )            return handleClientSub( client, req );
    else if ( req instanceof ClientUnsub )          return handleClientUnsub( client, req );
    else if ( req instanceof ClientReqFree )        return handleClientReqFree( client, req );
    else if ( req instanceof ClientReqLock )        return handleClientReqLock( client, req );

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
                    subLockEvt(ref, client);
                    break;
                case MutexoServerEvent.Free:
                    subUtxoFreeEvt(ref, client);
                    break;
                case MutexoServerEvent.Input:
                    subUtxoSpentEvt(ref, client);
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

async function handleClientUnsub( client: WebSocket, req: ClientUnsub ): Promise<void> 
{
    const { id, eventType, filters } = req;

    logger.debug("!- HANDLING MUTEXO CLIENT UNSUB MESSAGE [", id, "] -!");

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
                    unsubAddrLockEvt( addrStr, client );
                    break;
                case MutexoServerEvent.Lock:
                    unsubAddrFreeEvt( addrStr, client );
                    break;
                case MutexoServerEvent.Input:
                    unsubClientFromSpentAddr( addrStr, client );
                    break;
                case MutexoServerEvent.Output:
                    unsubClientFromOutput( addrStr, client );
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
                    unsubLockEvt( ref, client );
                    break;
                case MutexoServerEvent.Free:
                    unsubUtxoFreeEvt( ref, client );
                    break;
                case MutexoServerEvent.Input:
                    unsubUtxoSpent(ref, client);
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

async function handleClientReqLock( client: WebSocket, req: ClientReqLock ): Promise<void> 
{
    const { id, utxoRefs, required } = req;

    const lockable = utxoRefs.map(forceTxOutRefStr).filter((utxoRef) => unlockUTxO(client, utxoRef));

    if (lockable.length < required)
    {
        const msg = new MutexFailure({
            id,
            mutexOp: MutexOp.MutexoLock,
            utxoRefs: lockable.map((ref) => forceTxOutRef(ref)),
        }).toCbor().toBuffer();

        client.send(msg);
        return;
    }

    emitUtxoLockEvts( lockable );
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

        utxoLockSubs
            .get(data.ref)
            ?.forEach(client => {
                client.send(msg);
            });

        addrLockClients
            .get(data.addr)
            ?.forEach(client => {
                client.send(msg)
            });
    }
}

async function handleClientReqFree( client: WebSocket, req: ClientReqFree ): Promise<void> 
{
    const { id, utxoRefs } = req;

    logger.debug("!- HANDLING MUTEXO CLIENT FREE MESSAGE [", id, "] -!");

    const freed = utxoRefs.map( forceTxOutRefStr )
        .filter(( utxoRef ) => ( isBlockingUTxO( client, utxoRef ) ));

    if( freed.length === 0 ) 
    {        
        const msg = new MutexFailure({
            id,
            mutexOp: MutexOp.MutexoFree,
            utxoRefs: utxoRefs.map(( ref ) => forceTxOutRef( ref )),
        }).toCbor().toBuffer();

        client.send( msg );

        logger.debug("!- [", id, "] MUTEXO CLIENT FREE REQUEST HANDLED -!");

        return;
    }
    else 
    {
        freed.forEach(( ref ) => ( void unlockUTxO( client, ref ) ));

        const msg = new MutexSuccess({
            id,
            mutexOp: MutexOp.MutexoFree,
            utxoRefs: freed.map(( ref ) => forceTxOutRef( ref )),
        }).toCbor().toBuffer();

        client.send( msg );
        emitUtxoUtxoFreeEvts( freed );

        logger.debug("!- [", id, "] MUTEXO CLIENT FREE REQUEST HANDLED -!");

        return;
    }
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

        utxoFreeSubs
            .get(data.ref)
            ?.forEach(client => {
                client.send(msg);
            });

        addrFreeClients
            .get(data.addr)
            ?.forEach(client => {
                client.send(msg)
            });
    }
}

function heartbeat(this: WebSocket) {
    ( this as any ).isAlive = true;
}

function isAlive(thing: any): boolean {
    return thing?.isAlive === true;
}
