import { readFile } from "node:fs/promises";
import { MutexoServerCliArgs, MutexoServerConfig } from "./MutexoServerConfig";
import { defaultAddrs, defaultIngoreDotenv, defaultRedisUrl, defaultWssPort } from "../cli/defaults";
import { AddressStr } from "@harmoniclabs/cardano-ledger-ts";
import { isAddrStr } from "../utils/isAddrStr";
import { existsSync } from "node:fs";

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

    return {
        ignoreEnv,
        port: isTypeOrElse(
            args.redisUrl, "number",
            isTypeOrElse(
                jsonCfg.redisUrl, "number",
                defaultWssPort
            )
        ),
        nodeSocketPath,
        redisUrl: isTypeOrElse(
            args.redisUrl, "string",
            isTypeOrElse(
                jsonCfg.redisUrl, "string",
                defaultRedisUrl
            )
        ),
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