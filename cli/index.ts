import { execSync } from "child_process";
import { Command } from "commander";

const program = new Command();
// const defaultPath = "./.env";
const defaultAmount = 2;
const defaultTest = true;
const defaultRedisUrl = "redis://localhost:6379";

program
    .name("server")
    .description("Mutexo Web Socket Server CLI")
    .version("0.0.1");

program
    .command("start")
    .description("starts the WSS in test mode")
    .argument("[path]", "path to the .env file containing test addresses and redis access credentials"/*, `${defaultPath}`*/)
    .option("-t, --test <bool>", "test mode", `${defaultTest}`)
    .option("-a, --amount <int>", "number of test addresses to be followed", `${defaultAmount}`)
    .option("-ru, --redis-url <string>", "redis url to access the database", `${defaultRedisUrl}`)
    .action(( path, options ) => {
        // ---- debug ----
        console.log("--- Arguments received: ---");
        console.log(`> Path: ${path/* || defaultPath*/}`);
        console.log(`> Test: ${options.test || defaultTest}`);
        console.log(`> Amount: ${options.amount || defaultAmount}`);
        console.log(`> Redis URL: ${options.redisUrl || defaultRedisUrl}`);
        console.log("---------------------------\n");
        // ---------------

        execSync(`node ./dist/src/index.js ${path/* || defaultPath*/} ${options.test || defaultTest} ${options.amount || defaultAmount} ${options.redisUrl || defaultRedisUrl}`, { stdio: "inherit" });
    });

program.parse( process.argv );