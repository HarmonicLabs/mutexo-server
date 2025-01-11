import { execSync } from "child_process";
import { Command } from "commander";
import { config } from "dotenv";
import { defaultConfigPath, defaultRedisUrl, defaultTxs, defaultTest, defaultIngoreDotenv, defaultAddrs, defaultWssPort } from "./defaults";
import { isAddrStr } from "../utils/isAddrStr";
import { parseCliArgs } from "../MutexoServerConfig/parseCliArgs";
import { main } from "../main";
import { readFileSync } from "fs";

config();

const program = new Command();

program
    .name("mutexo-server")
    .description("Mutexo Web Socket Server CLI")
    .version(
        JSON.parse(
            readFileSync("./package.json", { encoding: "utf-8" })
        ).version
    );

program
    .command("start")
    .description("Starts the WebSocket server")
    .option(
        "-c, --config <string>",
        "path to the json configuration file, defaults to " + defaultConfigPath,
        defaultConfigPath
    )
    .option(
        "-E, --ignore-env", 
        "explicitly ignores the .env file",
        defaultIngoreDotenv
    )
    .option(
        "-a, --addr <string>",
        "address to be monitored (does NOT override config addresses)",
        (value, prev: string[]) => {
            if( isAddrStr( value ) ) prev.push(value);
            return prev;
        },
        defaultAddrs.slice()
    )
    .option(
        "-s, --node-socket-path <string>",
        "path to the cardano-node socket"
    )
    .option(
        "-ru, --redis-url <string>",
        "redis url to access the database as described at https://github.com/redis/node-redis/blob/master/docs/client-configuration.md"
    )
    .option(
        "-p, --port <number>",
        "port for the WebSocket server to listen to",
        defaultWssPort.toString()
    )
    .action(async ( options, program ) => {
        const cfg = await parseCliArgs( options );
        main( cfg );
        /*
        execSync(
            `node ./dist/src/index.js ${path} false undefined ${options.redisUrl ?? defaultRedisUrl}`,
            { stdio: "inherit" }
        );
        //*/
    });

program.parse( process.argv );
