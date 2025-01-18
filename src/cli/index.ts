import { execSync } from "child_process";
import { Command } from "commander";
import { config } from "dotenv";
import { defaultConfigPath, defaultIngoreDotenv, defaultWssPort, defaultNetwork } from "./defaults";
import { isAddrStr } from "../utils/isAddrStr";
import { parseCliArgs } from "../MutexoServerConfig/parseCliArgs";
import { main } from "../main";
import { readFileSync } from "fs";
import { CardanoNetworkMagic } from "@harmoniclabs/ouroboros-miniprotocols-ts";
import { strIsInt } from "../utils/strIsInt";

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
        "-E, --ignore-env", 
        "explicitly ignores the .env file",
        defaultIngoreDotenv
    )
    .option(
        "-a, --addr <string>",
        "cardano address to be monitored, can be specified multiple times",
        (value, prev: string[]) => {
            if( isAddrStr( value ) ) prev.push(value);
            return prev;
        },
        // defaultAddrs.slice()
    )
    .option(
        "-s, --node-socket-path <string>",
        "path to the cardano-node socket"
    )
    .option(
        "-p, --port <number>",
        "port for the WebSocket server to listen to",
        defaultWssPort.toString()
    )
    .action(async ( options, program ) => {
        if( process.argv.includes("help") )
        {
            program.help("start");
            return;
        }

        const cfg = await parseCliArgs( options );
        main( cfg );
    });

program.parse( process.argv );
