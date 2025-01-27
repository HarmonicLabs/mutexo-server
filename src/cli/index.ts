import { Command } from "commander";
import { config } from "dotenv";
import { defaultConfigPath, defaultIngoreDotenv, defaultNetwork, defaultHttpPort, defaultWssPorts, defaultPortRange, defaultThreads, defaultPortRangeStr, defaultAddrs } from "./defaults";
import { isAddrStr } from "../utils/isAddrStr";
import { parseCliArgs } from "../MutexoServerConfig/parseCliArgs";
import { main } from "../main";
import { readFileSync } from "fs";
import { CardanoNetworkMagic } from "@harmoniclabs/ouroboros-miniprotocols-ts";
import { strIsInt } from "../utils/strIsInt";
import { logger } from "../utils/Logger";

config();

const progName = "mutexo-server";
const progVersion: string = JSON.parse(
    readFileSync("./package.json", { encoding: "utf-8" })
).version;

const program = new Command();

program
    .name(progName)
    .description("Mutexo Web Socket Server CLI")
    .version( progVersion );

program
    .command("version")
    .description("Prints the version of the program")
    .action(() => {
        console.log(`${progName} version ${progVersion}`);
    });

program
    .command("start")
    .description("Starts the mutexo server")
    .option(
        "-c, --config <string>",
        "path to the json configuration file",
        defaultConfigPath
    )
    .option(
        "-n, --network <string>",
        "specify the network to use, either mainnet | preview | preprod; otherwise the network magic number",
        (value, prev: string | number | undefined) => {
            if( value === "mainnet" ) return CardanoNetworkMagic.Mainnet;
            if( value === "preview" ) return CardanoNetworkMagic.Preview;
            if( value === "preprod" ) return CardanoNetworkMagic.Preprod;
            if( strIsInt( value) ) 
            {
                const num = parseInt( value );
                if( num >= 0 ) return num;
            }
            return prev;
        },
        defaultNetwork
    )
    .option(
        "-a, --addr <string...>",
        "cardano address to be monitored, can be specified multiple times",
        (value, prev: string[]) => {
            if( !Array.isArray(prev) ) prev = [];
            if( isAddrStr( value ) ) prev.push(value);
            return prev;
        },
        defaultAddrs.slice()
    )
    .option(
        "-l, --log-level <string>",
        'either "debug" | "info" | "warn" | "error" | "none"',
        "info"
    )
    .option(
        "-t, --threads <string>",
        "percentage or number of threads to use; " +
        "if percentage, the number will be calculated based on the number of cores; " +
        "minimum 2 threads (chain-sync and ws-server)",
        defaultThreads
    )
    .option(
        "-s, --node-socket-path <string>",
        "path to the cardano-node socket"
    )
    .option(
        "-hp, --http-port <number>",
        "port of the http server (main thread)",
        defaultHttpPort.toString()
    )
    .option(
        "-ws, --ws-port <number...>",
        "port(s) of the web socket server(s); " +
        "if not enough ports are specified, random (aviable) ports will be used"
    )
    // .option(
    //     "-pr, --port-range <string>",
    //     "(format: /\\b\\d{2,5}-\\d{2,5}\\b/) range of ports to use for the web socket server(s);",
    //     defaultPortRangeStr
    // )
    .option(
        "--ignore-env", 
        "explicitly ignores the .env file",
        defaultIngoreDotenv
    )
    .option(
        "--disable-log-colors",
        "disables colors in the log output",
        false
    )
    .action(async ( options, program ) => {
        if( process.argv.includes("help") )
        {
            program.help("start");
            return;
        }

        const cfg = await parseCliArgs( options );
        logger.debug("running with config: ", cfg);

        if( cfg.addrs.length === 0 )
        {
            logger.error("no addresses specified");
            return;
        }
        return main( cfg );
    });

program.parse( process.argv );
