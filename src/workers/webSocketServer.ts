import { getClientUtxoSpentSubs, getClientAddrSpentSubs, getClientOutputsSubs, setWsClientIp, getWsClientIp, getClientUtxoFreeSubs, getClientUtxoLockSubs, getClientAddrFreeSubs, getClientAddrLockSubs } from "../wsServer/clientProps";
import { LEAKING_BUCKET_BY_IP_PREFIX, LEAKING_BUCKET_MAX_CAPACITY, LEAKING_BUCKET_TIME, TEMP_AUTH_TOKEN_PREFIX, UTXO_PREFIX, UTXO_VALUE_PREFIX } from "../constants";
import { MessageClose, MessageError, MessageFailure, MessageFree, MessageInput, MessageLock, MessageOutput, MessageSuccess } from "@harmoniclabs/mutexo-messages";
import { MutexoServerEvent, tryGetResolvedFreeMsg, tryGetResolvedLockMsg, tryGetSubMsg, tryGetUnsubMsg } from "../wsServer/events";
import { Address, AddressStr, forceTxOutRef, TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { addressIsFollowed, followAddr, isFollowingAddr } from "../redis/isFollowingAddr";
import { SavedFullTxOut, tryParseSavedTxOut } from "../funcs/saveUtxos";
import { getClientIp as getClientIpFromReq } from "request-ip";
import { getRedisClient } from "../redis/getRedisClient";
import { RawData, WebSocket, WebSocketServer } from "ws";
import { isTxOutRefStr } from "../utils/isTxOutRefStr";
import { filterInplace } from "../utils/filterInplace";
import { tryGetBlockInfos } from "../types/BlockInfos";
import { toHex } from "@harmoniclabs/uint8array-utils";
import { ValueJson } from "../types/UTxOWithStatus";
import { isObject } from "@harmoniclabs/obj-utils";
import { parentPort } from "node:worker_threads";
import { ipRateLimit } from "../middlewares/ip";
import { isAddrStr } from "../utils/isAddrStr";
import { unrawData } from "../utils/unrawData";
import { sign, verify } from "jsonwebtoken";
import { createServer } from "node:http";
import { webcrypto } from "node:crypto";
import { URL } from "node:url";
import express from "express";

// close message
const closeMsg = new MessageClose().toCborBytes();
// error messages
const missingIpMsg = new MessageError({ errorType: 1 }).toCborBytes();
const missingAuthTokenMsg = new MessageError({ errorType: 2 }).toCborBytes();       // to do: create a new "missing auth token" error type
const invalidAuthTokenMsg = new MessageError({ errorType: 2 }).toCborBytes();
const tooManyReqsMsg = new MessageError({ errorType: 3 }).toCborBytes();
const addrNotFollowedMsg = new MessageError({ errorType: 4 }).toCborBytes();
const utxoNotFoundMsg = new MessageError({ errorType: 5 }).toCborBytes();
const unknownSubEvtByAddrMsg = new MessageError({ errorType: 6 }).toCborBytes();
const unknownSubEvtByUTxORefMsg = new MessageError({ errorType: 7 }).toCborBytes();
const unknownUnsubEvtByAddrMsg = new MessageError({ errorType: 8 }).toCborBytes();
const unknownUnsubEvtByUTxORefMsg = new MessageError({ errorType: 9 }).toCborBytes();
const unknownUnsubEvtMsg = new MessageError({ errorType: 10 }).toCborBytes();       // to do: create a new "unknown event to unsubscribe to (no filters)" error type (???)


const app = express();
const http_server = createServer( app );
const wsServer = new WebSocketServer({ server: http_server, path: "/events", maxPayload: 512 });

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

    await redis.hSet( key, { secretHex } );
    await redis.expire( key, 30 );

    res.status( 200 ).send( tokenStr );
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
        client.send( invalidAuthTokenMsg );
        client.terminate();
        return;
    }

    const { secretHex } = infos;

    let stuff: any 
    try {
        stuff = verify( token, Buffer.from( secretHex, "hex" ) );
    } catch {
        client.send( invalidAuthTokenMsg );
        client.terminate();
        return;
    }

    setWsClientIp( client, ip );
    leakingBucketOp( client );
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

function stringToUint8Array( str: string ): Uint8Array 
{
    return new TextEncoder().encode(str);
}

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
            const txHash = outs[0].split("#")[0];
            await Promise.all([
                Promise.all(
                    ins.map( async inp => {
                        const addr = await redis.hGet( `${UTXO_PREFIX}:${inp}`, "addr" ) as AddressStr | undefined;
                        if( !addr ) return;

                        const msg = new MessageInput({
                            utxoRef: forceTxOutRef( inp ),
                            addr: Address.fromString( addr ),
                            txHash: stringToUint8Array( txHash )
                        }).toCborBytes();

                        spentUTxOClients.get( inp )?.forEach( client => client.send( msg ));
                        spentAddrClients.get( addr )?.forEach( client => client.send( msg ));
                    })
                ),
                Promise.all(
                    outs.map( async out => {
                        const addr = await redis.hGet( `${UTXO_PREFIX}:${out}`, "addr" ) as AddressStr | undefined;
                        if( !addr ) return;

                        const msg = new MessageOutput({
                            utxoRef: forceTxOutRef( out ),
                            addr: Address.fromString( addr )
                        }).toCborBytes();

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
 * it keeps track of the clients that are blocking a certain utxo
 */
const utxoBlockers: Map<TxOutRefStr, WebSocket> = new Map();

/** 
 * @returns {boolean} `true` if the given client is locking the given utxo, `false` otherwise
 */
function isBlockingUTxO( client: WebSocket, ref: TxOutRefStr ): boolean
{
    const wsInstance = utxoBlockers.get( ref );
    if( !wsInstance ) return false;

    const clientIP = getWsClientIp( client );
    if( !clientIP ) return false;

    const wsIP = getWsClientIp( wsInstance );
    if( !wsIP ) return false;
    
    return clientIP === wsIP;
}

/**
 * if possible, it locks the utxo for the given client 
 * @returns {boolean} `true` if the operation was succesful, `false` otherwise
 */
function lockUTxO( client: WebSocket, ref: TxOutRefStr ): boolean
{   
    // if true it means utxo is already locked
    if( utxoBlockers.get( ref ) ) return false;

    utxoBlockers.set( ref, client );
    
    return true;
}

/**
 * @returns {boolean} `true` if the utxo is free, `false` otherwise
 */
function canClientLockUTxO( ref: TxOutRefStr ): boolean
{
    // if ref is not into the map then it adds it associated to a null client 
    if( !utxoBlockers.has( ref ) ) return true;

    // if utxo its already locked then it returns false
    if( utxoBlockers.get( ref ) ) return false;
    
    return true;
}

/**
 * if possible and if the client is the one that locked the utxo, it frees the utxo
 * @returns {boolean} `true` if the operation was succesful, `false` otherwise
 */
function unlockUTxO( client: WebSocket, ref: TxOutRefStr ): boolean
{
    if( !isBlockingUTxO( client, ref ) ) return false;

    // `isBlockingUTxO` returned true, so we know we have a WebSocket client
    utxoBlockers.delete( ref );

    return true;
}

/**
 * map of clients who want to be notified once a certain utxo is freed
 */
const freeUTxOClients: Map<TxOutRefStr, Set<WebSocket>> = new Map();

/**
 * it subscribes a client to a utxo, waiting for it to be freed
 */
function subClientToFreeUTxO( ref: TxOutRefStr, client: WebSocket ): void
{
    if( !freeUTxOClients.has( ref ) ) freeUTxOClients.set( ref, new Set() );

    // it adds the client to the list of clients that are waiting for the utxo to be freed
    const wsListInstance = freeUTxOClients.get( ref )!;
    if( !wsListInstance.has( client ) ) wsListInstance.add( client );
    
    // it adds the utxo to the client's subscriptions
    getClientUtxoFreeSubs( client ).add( ref );
}

/**
 * once a utxo the client is waiting for is freed, it unsubscribe the client from the waiting list for that utxo
 */
function unsubClientFromFreeUTxO( ref: TxOutRefStr, client: WebSocket ): void
{
    // it removes the utxo from the client's subscriptions
    getClientUtxoFreeSubs( client ).delete( ref );

    const wsListInstance = freeUTxOClients.get( ref )!;
    if( !wsListInstance ) return;

    // if no clients have to unlock the utxo it removes that utxo from the map
    if( wsListInstance.size === 0 ) freeUTxOClients.delete( ref );
}

/**
 * map of clients who want to be notified once a certain utxo has been locked
 */
const lockedUTxOClients: Map<TxOutRefStr, Set<WebSocket>> = new Map();

/**
 * it subscribes a client that will be notified once a certain utxo is locked
 */
function subClientToLockedUTxO( ref: TxOutRefStr, client: WebSocket ): void
{
    if( !lockedUTxOClients.has( ref ) ) lockedUTxOClients.set( ref, new Set() );

    // it adds the client to the list of waiting clients for that utxo
    const wsListInstance = lockedUTxOClients.get( ref )!;
    if( !wsListInstance.has( client ) ) wsListInstance.add( client );
    
    // it adds the utxo to the client's subscriptions
    getClientUtxoLockSubs( client ).add( ref );
}

/**
 * it unsubscribes a client from the list of clients waiting for a certain utxo to be locked
 */
function unsubClientFromLockedUTxO( ref: TxOutRefStr, client: WebSocket ): void
{
    // it removes the utxo from the client's subscriptions
    getClientUtxoLockSubs( client ).delete( ref );

    const wsListInstance = lockedUTxOClients.get( ref )!;
    if( !wsListInstance ) return;

    // if no clients are waiting to lock the utxo it removes that utxo from the map
    if( wsListInstance.size === 0 ) lockedUTxOClients.delete( ref );
}

/**
 * it maps every WebSocket client associated to a specific address that is waiting 
 * to be notified if a certain utxo is released
 */
const freeAddressClients: Map<AddressStr, Set<WebSocket>> = new Map();

/**
 * it adds the "waiting for the utxo to be freed" client to its address lists
 */
function subClientToFreeAddr( addr: AddressStr, client: WebSocket ): void
{
    if( !freeAddressClients.has( addr ) ) freeAddressClients.set( addr, new Set() );

    const freeAddrInstance = freeAddressClients.get( addr )!;
    if( !freeAddrInstance.has( client ) ) freeAddrInstance.add( client );
    
    getClientAddrFreeSubs( client ).add( addr );
}

/**
 * it removes the "waiting for the utxo to be freed" client from its address lists
 */
function unsubClientFromFreeAddr( addr: AddressStr, client: WebSocket ): void
{
    getClientAddrFreeSubs( client ).delete( addr );

    const freeAddrInstance = freeAddressClients.get( addr )!;
    if( !freeAddrInstance ) return;

    if( freeAddrInstance.size === 0 ) freeAddressClients.delete( addr );
}

/**
 * it maps every WebSocket client associated to a specific address that is waiting 
 * to be notified if a certain utxo is locked
 */
const lockedAddressClients: Map<AddressStr, Set<WebSocket>> = new Map();

/**
 * it adds the "waiting for the utxo to be locked" client to its address lists
 */
function subClientToLockedAddr( addr: AddressStr, client: WebSocket ): void
{
    if( !lockedAddressClients.has( addr ) ) lockedAddressClients.set( addr, new Set() );

    const lockedAddrInstance = lockedAddressClients.get( addr )!;
    if( !lockedAddrInstance.has( client ) ) lockedAddrInstance.add( client );
    
    getClientAddrLockSubs( client ).add( addr );
}

/**
 * it removes the "waiting for the utxo to be locked" client from its address lists
 */
function unsubClientFromLockedAddr( addr: AddressStr, client: WebSocket ): void
{
    getClientAddrLockSubs( client ).delete( addr );

    const lockedAddrInstance = lockedAddressClients.get( addr )!;
    if( !lockedAddrInstance ) return;

    if( lockedAddrInstance.size === 0 ) lockedAddressClients.delete( addr );
}

/**
 * it maps who spent a certain utxo
 */
const spentUTxOClients: Map<TxOutRefStr, Set<WebSocket>> = new Map();

/**
 * it adds to the map a client and the utxo he spent
 */
function subClientToSpentUTxO( ref: TxOutRefStr, client: WebSocket ): void
{
    if( spentUTxOClients.has( ref ) ) spentUTxOClients.get( ref )!.add( client );
    else spentUTxOClients.set( ref, new Set([ client ]));

    getClientUtxoSpentSubs( client ).add( ref );
}

/**
 * it removes from the map a client and the utxo he spent
 */
function unsubClientFromSpentUTxO( ref: TxOutRefStr, client: WebSocket ): void
{
    spentUTxOClients.get( ref )?.delete( client );
    getClientUtxoSpentSubs( client ).delete( ref );
}

/**
 * it maps which address'websocket spent a utxo
 */
const spentAddrClients: Map<AddressStr , Set<WebSocket>> = new Map();

/**
 * it adds to the map a client address which websocket spent a utxo
 */
function subClientToSpentAddr( addr: AddressStr, client: WebSocket ): void
{
    if( spentAddrClients.has( addr ) ) spentAddrClients.get( addr )!.add( client );
    else spentAddrClients.set( addr, new Set([ client ]));

    getClientAddrSpentSubs( client ).add( addr );
}

/**
 * it removes from the map a client address which websocket spent a utxo
 */
function unsubClientFromSpentAddr( addr: AddressStr, client: WebSocket ): void
{
    spentAddrClients.get( addr )?.delete( client );
    getClientAddrSpentSubs( client ).delete( addr );
}

const outputClients: Map<AddressStr , Set<WebSocket>> = new Map();

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

        // if the public API key is not following this address (no matter if it exists or not)
        if( !await isFollowingAddr( addr ) )
        {
            // add the follow
            await followAddr( addr );
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

function unsubAllSpentUTxO( client: WebSocket )
{
    const UTXO_SPENT_SUBS = getClientUtxoSpentSubs( client );
    for( const ref of UTXO_SPENT_SUBS ) unsubClientFromSpentUTxO( ref, client );
}

function unsubAllSpentAddr( client: WebSocket )
{
    const ADDR_SPENT_SUBS = getClientAddrSpentSubs( client );
    for( const addr of ADDR_SPENT_SUBS ) unsubClientFromSpentAddr( addr, client );
}

function unsubAllOutput( client: WebSocket )
{
    const OUTPUT_SUBS = getClientOutputsSubs( client );
    for( const addr of OUTPUT_SUBS ) unsubClientToOutput( addr, client );
}

function unsubAllFreeUTxO( client: WebSocket )
{
    const UTXO_FREE_SUBS = getClientUtxoFreeSubs( client );
    for( const ref of UTXO_FREE_SUBS ) unsubClientFromFreeUTxO( ref, client );
}

function unsubAllLockedUTxO( client: WebSocket )
{
    const UTXO_LOCK_SUBS = getClientUtxoLockSubs( client );
    for( const ref of UTXO_LOCK_SUBS ) unsubClientFromLockedUTxO( ref, client );
}

function unsubAllFreeAddr( client: WebSocket )
{
    const ADDR_FREE_SUBS = getClientAddrFreeSubs( client );
    for( const addr of ADDR_FREE_SUBS ) unsubClientFromFreeAddr( addr, client );
}

function unsubAllLockedAddr( client: WebSocket )
{
    const ADDR_LOCK_SUBS = getClientAddrLockSubs( client );
    for( const addr of ADDR_LOCK_SUBS ) unsubClientFromLockedAddr( addr, client );
}

function unsubAll( client: WebSocket )
{
    unsubAllOutput( client );
    unsubAllSpentUTxO( client );
    unsubAllSpentAddr( client );
    unsubAllFreeUTxO( client );
    unsubAllLockedUTxO( client );
    unsubAllFreeAddr( client );
    unsubAllLockedAddr( client );
}

function terminateClient( client: WebSocket )
{
    unsubAll( client );
    client.terminate();
}

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

    if( sub && !unsub )
    {
        const { sub: event, filters } = sub;
        filters.forEach(({ addr, ref }) => {
            const addrIsStr = typeof addr === "string";
            const refIsStr  = typeof ref  === "string";
            if( addrIsStr ) // if both addr and ref are present only add address
            {
                isFollowingAddr( addr )
                .then( isFollowing => {
                    if( !isFollowing )
                    {
                        client.send( addrNotFollowedMsg );
                        return;
                    }
                    switch( event )
                    {
                        case MutexoServerEvent.Lock:
                            subClientToLockedAddr( addr, client );
                        break;
                        case MutexoServerEvent.Free:
                            subClientToFreeAddr( addr, client );
                        break;
                        case MutexoServerEvent.Input:
                            subClientToSpentAddr( addr, client );
                        break;
                        case MutexoServerEvent.Output:
                            subClientToOutput( addr, client );
                        break;
                        default:
                            client.send( unknownSubEvtByAddrMsg );
                        break;
                    }
                });
            }
            else if( refIsStr )
            {
                getRedisClient()
                .then( async redis => {
                    const addr = await redis.hGet( `${UTXO_PREFIX}:${ref}`, "addr" ) as AddressStr | undefined;
                    if( !addr || !await isFollowingAddr( addr ) )
                    {
                        client.send( utxoNotFoundMsg );
                        return;
                    }
                    switch( event )
                    {
                        case MutexoServerEvent.Lock:
                            subClientToLockedUTxO( ref, client );
                        break;
                        case MutexoServerEvent.Free:
                            subClientToFreeUTxO( ref, client );
                        break;
                        case MutexoServerEvent.Input:
                            subClientToSpentUTxO( ref, client );
                        break;
                        case MutexoServerEvent.Output:
                        default:
                            client.send( unknownSubEvtByUTxORefMsg );
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
                            unsubClientFromLockedAddr( addr, client );
                        break;
                        case MutexoServerEvent.Lock:
                            unsubClientFromFreeAddr( addr, client );
                        break;
                        case MutexoServerEvent.Input:
                            unsubClientFromSpentAddr( addr, client );
                        break;
                        case MutexoServerEvent.Output:
                            unsubClientToOutput( addr, client );
                        break;
                        default:
                            client.send( unknownUnsubEvtByAddrMsg );
                        break;
                    }
                }
                else if( refIsStr )
                {
                    switch( event )
                    {
                        case MutexoServerEvent.Lock:
                            unsubClientFromLockedUTxO( ref, client );
                        break;
                        case MutexoServerEvent.Free:
                            unsubClientFromFreeUTxO( ref, client );
                        break;
                        case MutexoServerEvent.Input:
                            unsubClientFromSpentUTxO( ref, client );
                        break;
        
                        case MutexoServerEvent.Output:
                        default:
                            client.send( unknownUnsubEvtByUTxORefMsg );
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
                    unsubAllLockedUTxO( client );
                    unsubAllLockedAddr( client );
                    break;
                case MutexoServerEvent.Free:
                    unsubAllFreeUTxO( client );
                    unsubAllFreeAddr( client );
                break;
                case MutexoServerEvent.Input:
                    unsubAllSpentUTxO( client );
                    unsubAllSpentAddr( client );
                break;

                case MutexoServerEvent.Output:
                    unsubAllOutput( client );
                break;
                default:
                    client.send( unknownUnsubEvtMsg );
                break;
            }
        }
        
    }

    // mutex messages
    const lock = tryGetResolvedLockMsg( json );
    const free = tryGetResolvedFreeMsg( json );
    
    if( free )
    {
        const freed = free.free.filter( ref => unlockUTxO( client, ref ) );
        if( freed.length === 0 )
        {
            const msg = new MessageFailure({
                failureData: {
                    failureType: 0,
                    utxoRefs: free.free.map( ( ref ) => ( forceTxOutRef( ref ) ) )
                }
            }).toCborBytes();
            
            client.send( msg );
        }
        else
        {
            const msg = new MessageSuccess({
                successData: {
                    successType: 0,
                    utxoRefs: freed.map( ( ref ) => ( forceTxOutRef( ref ) ) )
                }
            }).toCborBytes();
            
            client.send( msg );
            
            emitUtxoFreeEvts( freed );
        }
    }
    // check locks only if no "free" is specified
    else if( lock )
    {
        const lockable = lock.lock.filter( ref => canClientLockUTxO( ref ) );
        if( lockable.length < lock.required )
        {
            const msg = new MessageFailure({
                failureData: {
                    failureType: 1,
                    utxoRefs: lockable.map( ( ref ) => ( forceTxOutRef( ref ) ) )
                }
            }).toCborBytes();

            client.send( msg );
        }
        else
        {
            lockable.length = lock.required; // drop any extra
            lockable.forEach( ref => void lockUTxO( client, ref ) );

            const msg = new MessageSuccess({
                successData: {
                    successType: 0,
                    utxoRefs: lockable.map( ( ref ) => ( forceTxOutRef( ref ) ) )
                }
            }).toCborBytes();

            client.send( msg );

            emitUtxoLockEvts( lockable );
        }
    }
}

async function emitUtxoLockEvts( refs: TxOutRefStr[] ): Promise<void>
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
        const msg = new MessageLock({
            utxoRef: forceTxOutRef( data.ref ),
            addr: Address.fromString( data.addr )
        }).toCborBytes();

        lockedUTxOClients
        .get( data.ref )
        ?.forEach( client => {
            client.send( msg );
        });

        lockedAddressClients
        .get( data.addr )
        ?.forEach( client => {
            client.send( msg )
        });
    }
}

async function emitUtxoFreeEvts( refs: TxOutRefStr[] ): Promise<void>
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
        const msg = new MessageFree({
            utxoRef: forceTxOutRef( data.ref ),
            addr: Address.fromString( data.addr )
        }).toCborBytes();

        freeUTxOClients
        .get( data.ref )
        ?.forEach( client => {
            client.send( msg );
        });

        freeAddressClients
        .get( data.addr )
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
