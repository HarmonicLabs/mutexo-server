import { parentPort } from "node:worker_threads";
import { LEAKING_BUCKET_BY_IP_PREFIX, LEAKING_BUCKET_MAX_CAPACITY, LEAKING_BUCKET_TIME, TEMP_AUTH_TOKEN_PREFIX, UTXO_PREFIX, UTXO_VALUE_PREFIX } from "../constants";
import { AddressStr, TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { getRedisClient } from "../redis/getRedisClient";
import { isAddrStr } from "../utils/isAddrStr";
import { RawData, WebSocket, WebSocketServer } from "ws";
import express from "express";
import { createServer } from "node:http";
import { unrawData } from "../utils/unrawData";
import { isTxOutRefStr } from "../utils/isTxOutRefStr";
import { filterInplace } from "../utils/filterInplace";
import { ValueJson } from "../types/UTxOWithStatus";
import { SavedFullTxOut, tryParseSavedTxOut } from "../funcs/saveUtxos";
import { getClientApiKey, getClientUtxoSpentSubs, getClientAddrSpentSubs, type API_KEY, getClientOutputsSubs, setClientApiKey, setWsClientIp, getWsClientIp, getClientUtxoFreeSubs, getClientUtxoLockSubs, getClientAddrFreeSubs, getClientAddrLockSubs } from "../wsServer/clientProps";
import { isObject } from "@harmoniclabs/obj-utils";
import { tryGetBlockInfos } from "../types/BlockInfos";
import { MutexoServerEvent, tryGetResolvedFreeMsg, tryGetResolvedLockMsg, tryGetSubMsg, tryGetUnsubMsg } from "../wsServer/events";
import { addressIsFollowed, followAddr, isFollowingAddr } from "../redis/isFollowingAddr";
import { toHex } from "@harmoniclabs/uint8array-utils";
import { webcrypto } from "node:crypto";
import { sign, verify } from "jsonwebtoken";
import { URL } from "node:url";
import { getClientIp as getClientIpFromReq } from "request-ip";
import { ipRateLimit } from "../middlewares/ip";

// togliere api_key, sub e unsub

const app = express();
const http_server = createServer( app );
const wsServer = new WebSocketServer({ server: http_server, path: "/events", maxPayload: 512 });

const closeMsg = JSON.stringify({
    type: MutexoServerEvent.Close,
    data: {}
});

app.set("trust proxy", 1);

app.get("/wsAuth", ipRateLimit, async ( req, res ) => {
    const redis = await getRedisClient();
    let secretBytes = new Uint8Array( 32 );
    let tokenStr: string;
    const ip = getClientIpFromReq( req );
    do {
        webcrypto.getRandomValues( secretBytes );
        tokenStr = sign(
            { ip },
            Buffer.from( secretBytes ),
            { expiresIn: 30 }
        );
    } while ( await redis.exists( `${TEMP_AUTH_TOKEN_PREFIX}:${tokenStr}` ) );

    const key = `${TEMP_AUTH_TOKEN_PREFIX}:${tokenStr}`;

    const secretHex = toHex( secretBytes );

    await redis.hSet( key, { apiKey, secretHex } );
    await redis.expire( key, 30 );

    res.status( 200 ).send( tokenStr );
});

const missingAuthTokenMsg = JSON.stringify({
    type: MutexoServerEvent.Error,
    data: { msg: "missing auth token in url params" }
});

const missingIpMsg = JSON.stringify({
    type: MutexoServerEvent.Error,
    data: { msg: "missing Ip" }
});

async function leakingBucketOp( client: WebSocket ): Promise<number>
{
    const ip = getWsClientIp( client );
    const redis = await getRedisClient();
    const incr = await redis.incr( `${LEAKING_BUCKET_BY_IP_PREFIX}:${ip}` );
    setTimeout( () => redis.decr( `${LEAKING_BUCKET_BY_IP_PREFIX}:${ip}` ), LEAKING_BUCKET_TIME );
    return incr;
}

wsServer.on('connection', async ( client, req ) => {
    const ip = getClientIpFromReq( req );
    if( !ip )
    {
        client.send( missingIpMsg );
        client.terminate();
        return;
    }

    const url = new URL( req.url ?? "", "ws://" + req.headers.host + "/");
    const token = url.searchParams.get( "token" );

    if( !token )
    {
        client.send( missingAuthTokenMsg );
        client.terminate();
        return;
    }

    const redis = await getRedisClient();
    const infos = await redis.hGetAll( `${TEMP_AUTH_TOKEN_PREFIX}:${token}` );

    if( !infos )
    {
        client.send(JSON.stringify({
            type: MutexoServerEvent.Error,
            data: { msg: "invalid token; likely expired" }
        }));
        client.terminate();
        return;
    }

    const { apiKey, secretHex } = infos;

    let stuff: any 
    try {
        stuff = verify( token, Buffer.from( secretHex, "hex" ) );
    } catch {
        client.send(JSON.stringify({
            type: MutexoServerEvent.Error,
            data: { msg: "invalid token" }
        }));
        client.terminate();
        return;
    }

    setWsClientIp( client, ip );
    leakingBucketOp( client );
    setClientApiKey( client, apiKey );
    (client as any).isAlive = true;
    client.on( 'error', console.error );
    client.on( 'pong', heartbeat );
    client.on( 'ping', function handleClientPing( this: WebSocket ) { this.pong(); } );
    client.on( "message", handleClientMessage )
    // console.log( "connected to: ", req.socket.remoteAddress )
});

const pingInterval = setInterval(
    () => {
        const clients = wsServer.clients;
        for( const client of clients )
        {
            if( !isAlive( client ) ) {
                client.send( closeMsg );
                terminateClient( client );
                return;
            }

            (client as any).isAlive = false;
            client.ping();
        }
    },
    30_000
);
wsServer.on('close', () => clearInterval( pingInterval ) );

parentPort?.on("message", async msg => {
    if( !isObject( msg ) ) return;
    if( msg.type === "Block" )
    {
        const blockInfos = tryGetBlockInfos( msg.data );
        if( !blockInfos ) return;
        const redis = await getRedisClient();
        const txs = blockInfos.txs;

        for( const { ins, outs } of txs )
        {
            await Promise.all([
                Promise.all(
                    ins.map( async inp => {
                        const addr = await redis.hGet( `${UTXO_PREFIX}:${inp}`, "addr" ) as AddressStr | undefined;
                        if( !addr ) return;
                        const msg = JSON.stringify({
                            type: MutexoServerEvent.Input,
                            data: {
                                ref: inp,
                                addr
                            }
                        });
                        utxoSpentClients.get( inp )?.forEach( client => client.send( msg ));
                        addrSpentClients.get( addr )?.forEach( client => client.send( msg ));
                    })
                ),
                Promise.all(
                    outs.map( async out => {
                        const addr = await redis.hGet( `${UTXO_PREFIX}:${out}`, "addr" ) as AddressStr | undefined;
                        if( !addr ) return;
                        const msg = JSON.stringify({
                            type: MutexoServerEvent.Output,
                            data: {
                                ref: out,
                                addr
                            }
                        });
                        outputClients.get( addr )?.forEach( client => client.send( msg ));
                    })
                )
            ]);
        }
    }
});

app.post("/addAddrs", async ( req, res ) => {
    await addAddrs( req.body );
    res.status(200).send();
});

app.get("/utxos", async ( req, res ) => {
    res.status(200).send( await queryUtxos( req.body ) )
});

app.listen( 3000 );

/**
 * keep track of the clients that are blocking a given utxo
 */
const utxoBlockers : Map<TxOutRefStr, Map<API_KEY, WebSocket>> = new Map();

function isBlockingUtxo( client: WebSocket, ref: TxOutRefStr ): boolean
{
    const instances = utxoBlockers.get( ref );
    if( !instances ) return false;

    const apiKey = getClientApiKey( client );
    if( !apiKey ) return false;

    const blockingClient = instances.get( apiKey );
    if( !blockingClient ) return false;
    
    return client === blockingClient;
}

/**
 * @returns {boolean} `true` if the operation was succesful; `false` otherwise
 */
function lockUTxO( client: WebSocket, ref: TxOutRefStr ): boolean
{
    // if( isLockedForClient( client, ref ) ) return false;

    const apiKey = getClientApiKey( client );
    if( !apiKey ) return false;

    if( !utxoBlockers.has( ref ) ) utxoBlockers.set( ref, new Map() );

    const instances = utxoBlockers.get( ref )!;

    // utxo was locked
    if( instances.has( apiKey ) ) return false;
    
    instances.set( apiKey, client );
    return true;
}

function clientCanLockUTxO( client: WebSocket, ref: TxOutRefStr ): boolean
{
    const apiKey = getClientApiKey( client );
    if( !apiKey ) return false;

    if( !utxoBlockers.has( ref ) ) utxoBlockers.set( ref, new Map() );

    const instances = utxoBlockers.get( ref )!;

    // utxo was locked
    if( instances.has( apiKey ) ) return false;
    
    return true;
}

/**
 * @returns {boolean} `true` if the operation was succesful; `false` otherwise
 */
function unlockUTxO( client: WebSocket, ref: TxOutRefStr ): boolean
{
    if( !isBlockingUtxo( client, ref ) ) return false;

    // `isBlockingUtxo` returned true, so we know we have an apiKey
    const apiKey = getClientApiKey( client )!;

    utxoBlockers.get( ref )?.delete( apiKey );

    return true;
}

const utxoFreeClients  : Map<TxOutRefStr, Map<API_KEY, Set<WebSocket>>> = new Map();

function subClientToUtxoFree( ref: TxOutRefStr, apiKey: API_KEY, client: WebSocket ): void
{
    if( !utxoFreeClients.has( ref ) ) utxoFreeClients.set( ref, new Map() );
    const instances = utxoFreeClients.get( ref )!;
    if( !instances.has( apiKey ) ) instances.set( apiKey, new Set() );
    
    instances.get( apiKey )!.add( client );

    getClientUtxoFreeSubs( client ).add( ref );
}

function unsubClientToUtxoFree( ref: TxOutRefStr, apiKey: API_KEY, client: WebSocket ): void
{
    getClientUtxoFreeSubs( client ).delete( ref );

    const refClients = utxoFreeClients.get( ref );
    if( !refClients ) return;

    const projectClients = refClients.get( apiKey );
    if( projectClients )
    {
        projectClients.delete( client );
        if( projectClients.size === 0 ) refClients.delete( apiKey );
    }

    if( refClients.size === 0 ) utxoFreeClients.delete( ref );
}

const utxoLockClients  : Map<TxOutRefStr, Map<API_KEY, Set<WebSocket>>> = new Map();

function subClientToUtxoLock( ref: TxOutRefStr, apiKey: API_KEY, client: WebSocket ): void
{
    if( !utxoLockClients.has( ref ) ) utxoLockClients.set( ref, new Map() );
    const instances = utxoLockClients.get( ref )!;
    if( !instances.has( apiKey ) ) instances.set( apiKey, new Set() );
    
    instances.get( apiKey )!.add( client );

    getClientUtxoLockSubs( client ).add( ref );
}

function unsubClientToUtxoLock( ref: TxOutRefStr, apiKey: API_KEY, client: WebSocket ): void
{
    getClientUtxoLockSubs( client ).delete( ref );

    const refClients = utxoLockClients.get( ref );
    if( !refClients ) return;

    const projectClients = refClients.get( apiKey );
    if( projectClients )
    {
        projectClients.delete( client );
        if( projectClients.size === 0 ) refClients.delete( apiKey );
    }

    if( refClients.size === 0 ) utxoLockClients.delete( ref );
}

const addrFreeClients  : Map<AddressStr , Map<API_KEY, Set<WebSocket>>> = new Map();

function subClientToAddrFree( addr: AddressStr, apiKey: API_KEY, client: WebSocket ): void
{
    if( !addrFreeClients.has( addr ) ) addrFreeClients.set( addr, new Map() );
    const instances = addrFreeClients.get( addr )!;
    if( !instances.has( apiKey ) ) instances.set( apiKey, new Set() );
    
    instances.get( apiKey )!.add( client );

    getClientAddrFreeSubs( client ).add( addr );
}

function unsubClientToAddrFree( addr: AddressStr, apiKey: API_KEY, client: WebSocket ): void
{
    addrFreeClients.get( addr )?.get( apiKey )?.delete( client );
    getClientAddrFreeSubs( client ).delete( addr );

    if( addrFreeClients.get( addr )?.get( apiKey )?.size === 0 ) addrFreeClients.get( addr )?.delete( apiKey );
    if( addrFreeClients.get( addr )?.size === 0 ) addrFreeClients.delete( addr );
}

const addrLockClients  : Map<AddressStr , Map<API_KEY, Set<WebSocket>>> = new Map();

function subClientToAddrLock( addr: AddressStr, apiKey: API_KEY, client: WebSocket ): void
{
    if( !addrLockClients.has( addr ) ) addrLockClients.set( addr, new Map() );
    const instances = addrLockClients.get( addr )!;
    if( !instances.has( apiKey ) ) instances.set( apiKey, new Set() );
    
    instances.get( apiKey )!.add( client );

    getClientAddrLockSubs( client ).add( addr );
}

function unsubClientToAddrLock( addr: AddressStr, apiKey: API_KEY, client: WebSocket ): void
{
    addrLockClients.get( addr )?.get( apiKey )?.delete( client );
    getClientAddrLockSubs( client ).delete( addr );

    if( addrLockClients.get( addr )?.get( apiKey )?.size === 0 ) addrLockClients.get( addr )?.delete( apiKey );
    if( addrLockClients.get( addr )?.size === 0 ) addrLockClients.delete( addr );
}

const utxoSpentClients  : Map<TxOutRefStr, Set<WebSocket>> = new Map();

function subClientToUtxoSpent( ref: TxOutRefStr, client: WebSocket ): void
{
    if( utxoSpentClients.has( ref ) ) utxoSpentClients.get( ref )!.add( client );
    else utxoSpentClients.set( ref, new Set([ client ]));

    getClientUtxoSpentSubs( client ).add( ref );
}

function unsubClientToUtxoSpent( ref: TxOutRefStr, client: WebSocket ): void
{
    utxoSpentClients.get( ref )?.delete( client );
    getClientUtxoSpentSubs( client ).delete( ref );
}

const addrSpentClients  : Map<AddressStr , Set<WebSocket>> = new Map();

function subClientToAddrSpent( addr: AddressStr, client: WebSocket ): void
{
    if( addrSpentClients.has( addr ) ) addrSpentClients.get( addr )!.add( client );
    else addrSpentClients.set( addr, new Set([ client ]));

    getClientAddrSpentSubs( client ).add( addr );
}

function unsubClientToAddrSpent( addr: AddressStr, client: WebSocket ): void
{
    addrSpentClients.get( addr )?.delete( client );
    getClientAddrSpentSubs( client ).delete( addr );
}

const outputClients     : Map<AddressStr , Set<WebSocket>> = new Map();

function subClientToOutput( addr: AddressStr, client: WebSocket ): void
{
    if( outputClients.has( addr ) ) outputClients.get( addr )!.add( client );
    else outputClients.set( addr, new Set([ client ]));

    getClientOutputsSubs( client ).add( addr );
}

function unsubClientToOutput( addr: AddressStr, client: WebSocket ): void
{
    outputClients.get( addr )?.delete( client );
    getClientOutputsSubs( client ).delete( addr );
}

function sendUtxoQueryRequest( addresses: AddressStr[] ): void
{
    if( addresses.length > 0 )
    {
        parentPort?.postMessage({
            type: "queryAddrsUtxos",
            data: addresses
        });
    }
}

// addAddrs([ "addr_test1wrzefj03mkklj352vueeum984wynqpjsvjxd6qeemfdaa5cd5jrfe" ] );

async function addAddrs( addresses: AddressStr[] ): Promise<void>
{
    const redis = await getRedisClient();

    let addr: AddressStr;
    for( let i = 0; i < addresses.length; )
    {
        addr = addresses[i];
        if( !isAddrStr( addr ) )
        {
            addresses.splice( i, 1 );
            continue;
        }
        
        if( await addressIsFollowed( addr ) )
        {
            // don't query address we are already following
            addresses.splice( i, 1 );
        }
        else
        {
            // next loop check next address
            i++;
            // `isFollowingAddr` evaluating to false will take care of adding the address
        }

        // if this particular API key is not following this address (no matter if it exists or not)
        if( !await isFollowingAddr( addr ) )
        {
            // add the follow
            await followAddr( addr, apiKey );
        }
    }

    sendUtxoQueryRequest( addresses );
}

async function queryUtxos( refs: TxOutRefStr[] ): Promise<(SavedFullTxOut & { ref: TxOutRefStr })[]>
{
    const redis = await getRedisClient();

    filterInplace( refs, isTxOutRefStr );

    const [ h_utxos, wrappedValues ] = await Promise.all([
        Promise.all( refs.map( ref => redis.hGetAll(`${UTXO_PREFIX}:${ref}`) ) ),
        redis.json.mGet( refs.map( ref => `${UTXO_VALUE_PREFIX}:${ref}` ), "$" ) as Promise<[ValueJson][]>
    ]);

    const len = h_utxos.length;

    const utxos: (SavedFullTxOut & Record<"ref",TxOutRefStr>)[] = new Array( len );

    for( let i = 0; i < utxos.length; )
    {
        const saved = tryParseSavedTxOut( h_utxos[i] );
        
        if( !saved ){
            void utxos.splice( i, 1 );
            void wrappedValues.splice( i, 1 );
        }
        else
        {
            utxos[i] = {
                ref: refs[i],
                ...saved,
                value: wrappedValues[i][0]
            };
            i++;
        }
    }

    return utxos;
}

function unsubAddrFree( client: WebSocket, addr: AddressStr )
{
    const apiKey = getClientApiKey( client );

    if( !apiKey ) return;

    let set: Set<WebSocket> | undefined = undefined;
    let api_map: Map<API_KEY, Set<WebSocket>> | undefined = undefined;

    api_map = addrFreeClients.get( addr );
    if( api_map )
    {
        set = api_map.get( apiKey );
        if( set )
        {
            set.delete( client )
            if( set.size === 0 )
            {
                api_map.delete( apiKey );
                if( api_map.size === 0 )
                {
                    addrFreeClients.delete( addr );
                }
            }
        }
    }
}

function unsubAddrLock( client: WebSocket, addr: AddressStr )
{
    const apiKey = getClientApiKey( client );

    if( !apiKey ) return;

    let set: Set<WebSocket> | undefined = undefined;
    let api_map: Map<API_KEY, Set<WebSocket>> | undefined = undefined;

    api_map = addrLockClients.get( addr );
    if( api_map )
    {
        set = api_map.get( apiKey );
        if( set )
        {
            set.delete( client )
            if( set.size === 0 )
            {
                api_map.delete( apiKey );
                if( api_map.size === 0 )
                {
                    addrLockClients.delete( addr );
                }
            }
        }
    }
}

function unsubAllUtxoSpent( client: WebSocket )
{
    const UTXO_SPENT_SUBS = getClientUtxoSpentSubs( client );
    for( const ref of UTXO_SPENT_SUBS ) unsubClientToUtxoSpent( ref, client );
}

function unsubAllAddrSpent( client: WebSocket )
{
    const ADDR_SPENT_SUBS = getClientAddrSpentSubs( client );
    for( const addr of ADDR_SPENT_SUBS ) unsubClientToAddrSpent( addr, client );
}

function unsubAllOutput( client: WebSocket )
{
    const OUTPUT_SUBS = getClientOutputsSubs( client );
    for( const addr of OUTPUT_SUBS ) unsubClientToOutput( addr, client );
}

function unsubAllUtxoFree( client: WebSocket )
{
    const apiKey = getClientApiKey( client );
    if( typeof apiKey !== "string" ) return;

    const UTXO_FREE_SUBS = getClientUtxoFreeSubs( client );
    for( const ref of UTXO_FREE_SUBS ) unsubClientToUtxoFree( ref, apiKey, client );
}

function unsubAllUtxoLock( client: WebSocket )
{
    const apiKey = getClientApiKey( client );
    if( typeof apiKey !== "string" ) return;

    const UTXO_LOCK_SUBS = getClientUtxoLockSubs( client );
    for( const ref of UTXO_LOCK_SUBS ) unsubClientToUtxoLock( ref, apiKey, client );
}

function unsubAllAddrFree( client: WebSocket )
{
    const apiKey = getClientApiKey( client );
    if( typeof apiKey !== "string" ) return;

    const ADDR_FREE_SUBS = getClientAddrFreeSubs( client );
    for( const addr of ADDR_FREE_SUBS ) unsubClientToAddrFree( addr, apiKey, client );
}

function unsubAllAddrLock( client: WebSocket )
{
    const apiKey = getClientApiKey( client );
    if( typeof apiKey !== "string" ) return;

    const ADDR_LOCK_SUBS = getClientAddrLockSubs( client );
    for( const addr of ADDR_LOCK_SUBS ) unsubClientToAddrLock( addr, apiKey, client );
}

function unsubAll( client: WebSocket )
{
    unsubAllOutput( client );
    unsubAllUtxoSpent( client );
    unsubAllAddrSpent( client );
    unsubAllUtxoFree( client );
    unsubAllUtxoLock( client );
    unsubAllAddrFree( client );
    unsubAllAddrLock( client );
}

function terminateClient( client: WebSocket )
{
    unsubAll( client );
    client.terminate();
}

const tooManyReqsMsg = JSON.stringify({
    type: MutexoServerEvent.Error,
    data: { msg: "be patient! too many requests; wait a few seconds" }
});

/**
 * - sub + filters
 * - unsub
 * - lock
 * - free
 */
async function handleClientMessage( this: WebSocket, rawData: RawData ): Promise<void>
{
    const client = this;
    // heartbeat
    (client as any).isAlive = true;

    const reqsInLastMinute = await leakingBucketOp( client );
    if( reqsInLastMinute > LEAKING_BUCKET_MAX_CAPACITY )
    {
        client.send( tooManyReqsMsg );
        return;
    }

    const data = unrawData( rawData );

    // NO big messages
    if( data.length > 2048 ) return;

    let json: any;
    
    try {
        json = JSON.parse( data.toString("utf-8") );
    } catch {
        return;
    }

    if(!(
        typeof json === "object" &&
        json !== null &&
        !Array.isArray( json )
    )) return;

    const sub = tryGetSubMsg( json );
    const unsub = tryGetUnsubMsg( json );

    /*
    const addrIsStr = typeof json.addr === "string";
    const refIsStr  = typeof json.ref  === "string";
    const addr = addrIsStr ? json.addr : undefined;
    const ref  = refIsStr  ? json.ref  : undefined;
    */

    const apiKey = getClientApiKey( client );
    if( !apiKey ) return;

    if( sub && !unsub )
    {
        const { sub: event, filters } = sub;
        filters.forEach(({ addr, ref }) => {
            const addrIsStr = typeof addr === "string";
            const refIsStr  = typeof ref  === "string";
            if( addrIsStr ) // if both addr and ref are present only add address
            {
                isFollowingAddr( apiKey, addr )
                .then( isFollowing => {
                    if( !isFollowing )
                    {
                        client.send(JSON.stringify({
                            type: MutexoServerEvent.Error,
                            data: {
                                msg: "address not followed",
                                addr
                            }
                        }));
                        return;
                    }
                    switch( event )
                    {
                        case MutexoServerEvent.Lock:
                            subClientToAddrLock( addr, apiKey, client );
                        break;
                        case MutexoServerEvent.Free:
                            subClientToAddrFree( addr, apiKey, client );
                        break;
                        case MutexoServerEvent.Input:
                            subClientToAddrSpent( addr, client );
                        break;
                        case MutexoServerEvent.Output:
                            subClientToOutput( addr, client );
                        break;
                        default:
                            client.send(JSON.stringify({
                                type: MutexoServerEvent.Error,
                                data: {
                                    msg: "unknown event to subscribe to (by address)",
                                    evt: sub
                                }
                            }));
                        break;
                    }
                });
            }
            else if( refIsStr )
            {
                getRedisClient()
                .then( async redis => {
                    const addr = await redis.hGet( `${UTXO_PREFIX}:${ref}`, "addr" ) as AddressStr | undefined;
                    if( !addr || !await isFollowingAddr( apiKey, addr ) )
                    {
                        client.send(JSON.stringify({
                            type: MutexoServerEvent.Error,
                            data: {
                                msg: "could not find utxo",
                                ref
                            }
                        }));
                        return;
                    }
                    switch( event )
                    {
                        case MutexoServerEvent.Lock:
                            subClientToUtxoLock( ref, apiKey, client );
                        break;
                        case MutexoServerEvent.Free:
                            subClientToUtxoFree( ref, apiKey, client );
                        break;
                        case MutexoServerEvent.Input:
                            subClientToUtxoSpent( ref, client );
                        break;
                        case MutexoServerEvent.Output:
                        default:
                            client.send(JSON.stringify({
                                type: MutexoServerEvent.Error,
                                data: {
                                    msg: "unknown event to subscribe to (by ref)",
                                    evt: sub
                                }
                            }));
                        break;
                    }
                });
            }
        });
    }

    if( unsub )
    {
        const { unsub: event, filters } = unsub
        if( Array.isArray( filters ) )
        {
            filters.forEach(({ addr, ref }) => {
                const addrIsStr = typeof addr === "string";
                const refIsStr  = typeof ref  === "string";
                if( addrIsStr )
                {
                    switch( event )
                    {
                        case MutexoServerEvent.Free:
                            unsubClientToAddrLock( addr, apiKey, client );
                        break;
                        case MutexoServerEvent.Lock:
                            unsubClientToAddrFree( addr, apiKey, client );
                        break;
                        case MutexoServerEvent.Input:
                            unsubClientToAddrSpent( addr, client );
                        break;
                        case MutexoServerEvent.Output:
                            unsubClientToOutput( addr, client );
                        break;
                        default:
                            client.send(JSON.stringify({
                                type: MutexoServerEvent.Error,
                                data: {
                                    msg: "unknown event to unsubscribe to (by address)",
                                    evt: unsub
                                }
                            }));
                        break;
                    }
                }
                else if( refIsStr )
                {
                    switch( event )
                    {
                        case MutexoServerEvent.Lock:
                            unsubClientToUtxoLock( ref, apiKey, client );
                        break;
                        case MutexoServerEvent.Free:
                            unsubClientToUtxoFree( ref, apiKey, client );
                        break;
                        case MutexoServerEvent.Input:
                            unsubClientToUtxoSpent( ref, client );
                        break;
        
                        case MutexoServerEvent.Output:
                        default:
                            client.send(JSON.stringify({
                                type: MutexoServerEvent.Error,
                                data: {
                                    msg: "unknown event to unsubscribe to (by ref)",
                                    evt: unsub
                                }
                            }));
                        break;
                    }
                }
            })
        }
        else // unsub all
        {
            switch( event )
            {
                case MutexoServerEvent.Lock:
                    unsubAllUtxoLock( client );
                    unsubAllAddrLock( client );
                    break;
                case MutexoServerEvent.Free:
                    unsubAllUtxoFree( client );
                    unsubAllAddrFree( client );
                break;
                case MutexoServerEvent.Input:
                    unsubAllUtxoSpent( client );
                    unsubAllAddrSpent( client );
                break;

                case MutexoServerEvent.Output:
                    unsubAllOutput( client );
                break;
                default:
                    client.send(JSON.stringify({
                        type: MutexoServerEvent.Error,
                        data: {
                            msg: "unknown event to unsubscribe to (no filters)",
                            evt: unsub
                        }
                    }));
                break;
            }
        }
        
    }

    // mutex messages
    const lock = tryGetResolvedLockMsg( json );
    const free = tryGetResolvedFreeMsg( json );

    // api key reqired for mutex messages
    if( typeof apiKey !== "string" ) return;
    
    if( free )
    {
        const freed = free.free.filter( ref => unlockUTxO( client, ref ) );
        if( freed.length === 0 )
        {
            client.send(
                JSON.stringify({
                    type: MutexoServerEvent.Failure,
                    data: {
                        msg: "invalid free call; no utxos freed",
                        ref: free.free
                    }
                })
            );
        }
        else
        {
            client.send(
                JSON.stringify({
                    type: MutexoServerEvent.Success,
                    data: {
                        op: MutexoServerEvent.Free,
                        refs: freed
                    }
                })
            );
            emitUtxoFreeEvts( freed, apiKey );
        }
    }
    // check locks only if no "free" is specified
    else if( lock )
    {
        const lockable = lock.lock.filter( ref => clientCanLockUTxO( client, ref ) );
        if( lockable.length < lock.required )
        {
            client.send(
                JSON.stringify({
                    type: MutexoServerEvent.Failure,
                    data: {
                        msg: "invalid lock call; not enough utxos",
                        aviable: lockable
                    }
                })
            );
        }
        else
        {
            lockable.length = lock.required; // drop any extra
            lockable.forEach( ref => void lockUTxO( client, ref ) );
            client.send(
                JSON.stringify({
                    type: MutexoServerEvent.Success,
                    data: {
                        op: MutexoServerEvent.Lock,
                        refs: lockable
                    }
                })
            );
            emitUtxoLockEvts( lockable, apiKey );
        }
    }
}

async function emitUtxoLockEvts( refs: TxOutRefStr[], apiKey: API_KEY ): Promise<void>
{
    const redis = await getRedisClient();

    const datas = await Promise.all(
        refs.map( async ref => {
            const addr = await redis.hGet( `${UTXO_PREFIX}:${ref}`, "addr" )! as AddressStr;
            return { ref, addr }
        })
    );

    for( const data of datas )
    {
        const msg = JSON.stringify({
            type: MutexoServerEvent.Lock,
            data
        });

        utxoLockClients
        .get( data.ref )
        ?.get( apiKey )
        ?.forEach( client => {
            client.send( msg );
        });

        addrLockClients
        .get( data.addr )
        ?.get( apiKey )
        ?.forEach( client => {
            client.send( msg )
        });
    }
}

async function emitUtxoFreeEvts( refs: TxOutRefStr[], apiKey: API_KEY ): Promise<void>
{
    const redis = await getRedisClient();

    const datas = await Promise.all(
        refs.map( async ref => {
            const addr = await redis.hGet( `${UTXO_PREFIX}:${ref}`, "addr" )! as AddressStr;
            return { ref, addr }
        })
    );

    for( const data of datas )
    {
        const msg = JSON.stringify({
            type: MutexoServerEvent.Free,
            data
        });

        utxoFreeClients
        .get( data.ref )
        ?.get( apiKey )
        ?.forEach( client => {
            client.send( msg );
        });

        addrFreeClients
        .get( data.addr )
        ?.get( apiKey )
        ?.forEach( client => {
            client.send( msg )
        });
    }
}

function heartbeat( this: WebSocket ) {
    (this as any).isAlive = true;
}

function isAlive( thing: any ): boolean
{
    return thing?.isAlive === true;
}
