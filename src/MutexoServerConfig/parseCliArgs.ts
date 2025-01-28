import { readFile } from "node:fs/promises";
import { MutexoServerCliArgs, MutexoServerConfig } from "./MutexoServerConfig";
import { defaultAddrs, defaultConfigPath, defaultHttpPort, defaultIngoreDotenv, defaultLocalConfigPath, defaultNetwork, defaultPortRange, defaultThreads, defaultWssPorts } from "../cli/defaults";
import { AddressStr } from "@harmoniclabs/cardano-ledger-ts";
import { isAddrStr } from "../utils/isAddrStr";
import { existsSync } from "node:fs";
import { CardanoNetworkMagic } from "@harmoniclabs/ouroboros-miniprotocols-ts";
import { availableParallelism, cpus } from "node:os";
import { isLogLevelString, Logger, logger, LogLevel, logLevelFromString } from "../utils/Logger";

export async function parseCliArgs( args: Partial<MutexoServerCliArgs> ): Promise<MutexoServerConfig>
{
    const jsonCfg = (
        typeof args.config === "string" && existsSync( args.config ) ?
        JSON.parse(
            await readFile( args.config, { encoding: "utf-8" } )
        ) as Partial<MutexoServerConfig>
        : (
            existsSync( defaultConfigPath ) ?
            JSON.parse(
                await readFile( defaultConfigPath, { encoding: "utf-8" }
            ) ) as Partial<MutexoServerConfig> :
            existsSync( defaultLocalConfigPath ) ?
            JSON.parse(
                await readFile( defaultLocalConfigPath, { encoding: "utf-8" }
            ) ) as Partial<MutexoServerConfig>
        : {})
    );

    console.log( "jsonCfg: ", jsonCfg );

    function get<T>(
        key: keyof MutexoServerConfig,
        type: "string" | "number" | "bigint" | "boolean" | "symbol" | "undefined" | "object" | "function" | ((thing: any) => thing is T),
        defaultValue: T
    ): T
    {
        const argKey: keyof MutexoServerCliArgs = (
            key === "addrs" ? "addr" :
            key === "wsPorts" ? "wsPort" :
            key
        );
        return isTypeOrElse(
            args[argKey], type,
            isTypeOrElse(
                jsonCfg[key], type,
                defaultValue
            )
        );
    }

    const cfgAddrs = getAddrsStrArr( jsonCfg.addrs );
    const argsAddrs = getAddrsStrArr( args.addr );

    const addrs = [ ...new Set( defaultAddrs.concat( cfgAddrs, argsAddrs ) ) ];

    const ignoreEnv: boolean = get(
        "ignoreEnv",
        "boolean",
        defaultIngoreDotenv
    );

    let nodeSocketPath = get<string | undefined>(
        "nodeSocketPath", "string",
        undefined
    );

    if( !nodeSocketPath && !ignoreEnv )
    {
        nodeSocketPath = process.env.CARDANO_NODE_SOCKET_PATH;
    }
    
    if( !nodeSocketPath ) throw new Error("No node socket path provided");
    if( !existsSync( nodeSocketPath ) ) throw new Error("Node socket path does not exist or has been moved");

    const network = (
        getNetworkMagic( args.network ) ?? 
        getNetworkMagic( jsonCfg.network ) ??
        getNetworkMagic( defaultNetwork )!
    );

    const threads = parseThreads(
        get<string | number>(
            "threads",
            x => typeof x === "string" || typeof x === "number",
            defaultThreads
        )
    );
    const wsThreads = threads - 1;

    const logLevel = logLevelFromString(
        get(
            "logLevel",
            isLogLevelString,
            "INFO"        
        )
    );

    const disableLogColors = get(
        "disableLogColors",
        "boolean",
        false
    );

    logger.setLogLevel( logLevel );
    logger.useColors( !disableLogColors );

    return {
        network,
        threads,
        logLevel,
        nodeSocketPath,
        httpPort: get<number>(
            "httpPort", "number",
            defaultHttpPort
        ),
        wsPorts: get(
            "wsPorts",
            x => Array.isArray( x ) && x.every( elem => typeof elem === "number" ),
            defaultWssPorts.slice()
        ),
        portRange: parsePortRange(
            get<string | any[]>(
                "portRange", 
                x => Array.isArray( x ) || typeof x === "string",
                defaultPortRange
            )
        ),
        addrs,
        ignoreEnv,
        disableLogColors
    };
}

function isTypeOrElse<T>(
    value: any,
    type: "string" | "number" | "bigint" | "boolean" | "symbol" | "undefined" | "object" | "function" | ((thing: any) => thing is T),
    orElse: T
): T
{
    if( typeof type === "function" )
    {
        return type(value) ? value : orElse;
    }
    return typeof value === type ? value : orElse;
}

function getAddrsStrArr( thing: any ): AddressStr[]
{
    if(!Array.isArray(thing)) return [];
    thing = thing.filter( isAddrStr );
    if( thing.length <= 0 ) return [];
    return thing as AddressStr[];
}

function getNetworkMagic( thing: any ): number | undefined
{
    if(
        typeof thing === "number" &&
        Number.isSafeInteger( thing ) &&
        thing > 0
    ) return thing;
    if( typeof thing === "string" )
    {
        if( thing === "mainnet" ) return CardanoNetworkMagic.Mainnet;
        if( thing === "preview" ) return CardanoNetworkMagic.Preview;
        if( thing === "preprod" ) return CardanoNetworkMagic.Preprod;
    }
    return undefined;
}

const minThreads = 2;
const maxThreads = Math.max( availableParallelism(), cpus().length );

function normalizeThreads( val: number ): number
{
    return Math.max( minThreads, Math.min( maxThreads, val ) );
}

function parseThreads( val: string | number ): number
{
    if( typeof val === "number" ) return normalizeThreads( val );
    if( typeof val === "string" )
    {
        val = val.trim();
        if( val.endsWith("%") )
        {
            const num = parseInt( val.slice(0, -1) );
            return normalizeThreads(
                (maxThreads * num / 100) >>> 0
            );
        }
        
        return normalizeThreads( parseInt( val ) ); 
    }
    return Math.max( maxThreads >>> 1, minThreads );
}

function parsePortRange( val: string | any[] ): [number, number]
{
    const defaultResult = defaultPortRange.slice() as [number, number];

    if( Array.isArray( val ) )
    {
        val = val.filter( x => typeof x === "number" );
        
        if( val.length < 2 )return defaultResult;
        
        val.length = 2;
        const [a,b] = val;
        
        return [Math.min(a,b), Math.max(a,b)];
    }

    if( typeof val !== "string" ) return defaultResult;
    
    val = val.trim();

    if( !/\b\d{2,5}-\d{2,5}\b/.test( val ) ) return defaultResult;

    const [a,b] = val.split("-").map( x => parseInt(x) );

    return [Math.min(a,b), Math.max(a,b)];
}