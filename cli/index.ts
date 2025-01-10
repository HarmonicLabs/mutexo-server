import { execSync } from "child_process";
import { Command } from "commander";

const program = new Command();
const defaultPath = "./.env";
const defaultAmount = 2;
const defaultTest = true;
const defaultRedisUrl = "redis://localhost:6379";

program
    .name("mutexo-server")
    .description("Mutexo Web Socket Server CLI")
    .version("0.0.1");

program
    .command("main")
    .description("It starts the WSS")
    .argument("[path]", "path to the .env file containing all the redis access credentials")
    .option("-ru, --redis-url <string>", "redis url to access the database as described at https://github.com/redis/node-redis/blob/master/docs/client-configuration.md", `${defaultRedisUrl}`)
    .action(( path, options ) => {
        execSync(`node ./dist/src/index.js ${path} ${!defaultTest} undefined ${options.redisUrl || defaultRedisUrl}`, { stdio: "inherit" });
    });

program
    .command("test")
    .description("It starts the WSS in test mode")
    .argument("[path]", "path to the .env file containing test addresses and redis access credentials", `${defaultPath}`)
    .option("-a, --amount <int>", "number of test addresses txs to be saved", `${defaultAmount}`)
    .option("-ru, --redis-url <string>", "redis url to access the database as described at https://github.com/redis/node-redis/blob/master/docs/client-configuration.md", `${defaultRedisUrl}`)
    .action(( path, options ) => {
        // ---- debug ----
        console.log("--- Arguments received: ---");
        console.log(`> Path: ${path || defaultPath}`);
        console.log(`> Amount: ${options.amount || defaultAmount}`);
        console.log(`> Redis URL: ${options.redisUrl || defaultRedisUrl}`);
        console.log("---------------------------\n");
        // ---------------

        execSync(`node ./dist/src/index.js ${path || defaultPath} ${defaultTest} ${options.amount || defaultAmount} ${options.redisUrl || defaultRedisUrl}`, { stdio: "inherit" });
    });

program.parse( process.argv );
