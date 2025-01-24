import { readFile } from "node:fs/promises";
import { MutexoServerCliArgs, MutexoServerConfig } from "./MutexoServerConfig";
import { defaultAddrs, defaultIngoreDotenv, defaultNetwork, defaultWssPort } from "../cli/defaults";
import { AddressStr } from "@harmoniclabs/cardano-ledger-ts";
import { isAddrStr } from "../utils/isAddrStr";
import { existsSync } from "node:fs";
import { CardanoNetworkMagic } from "@harmoniclabs/ouroboros-miniprotocols-ts";

export async function parseCliArgs( args: Partial<MutexoServerCliArgs> ): Promise<MutexoServerConfig>
{
    const jsonCfg = (
        typeof args.configPath === "string" && existsSync( args.configPath ) ?
        JSON.parse(
            await readFile( args.configPath, { encoding: "utf-8" } )
        ) as Partial<MutexoServerConfig>
        : {}
    );

    const cfgAddrs = getAddrsStrArr( jsonCfg.addrs );
    const argsAddrs = getAddrsStrArr( args.addr );

    const addrs = [ ...new Set( defaultAddrs.concat( cfgAddrs, argsAddrs ) ) ];

    const ignoreEnv: boolean = isTypeOrElse(
        args.ignoreEnv, "boolean", 
        isTypeOrElse(
            jsonCfg.ignoreEnv, "boolean",
            defaultIngoreDotenv
        )
    );

    let nodeSocketPath = isTypeOrElse<string | undefined>(
        args.nodeSocketPath, "string",
        isTypeOrElse(
            jsonCfg.nodeSocketPath, "string",
            undefined
        )
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

    return {
        ignoreEnv,
        port: isTypeOrElse(
            args.port, "number",
            isTypeOrElse(
                jsonCfg.port, "number",
                defaultWssPort
            )
        ),
        nodeSocketPath,
        network,
        addrs
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