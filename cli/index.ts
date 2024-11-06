import { execSync } from "child_process";

const { Command } = require("commander");
const program = new Command();

program
    .name("server")
    .description("Mutexo Web Socket Server CLI")
    .version("0.0.1");

program
    .command("start")
    .description("starts the WSS")
    // .argument("<number>", "number of test addresses to follow")
    // .option("-t, --test <number>", "number of test addresses to follow", "1")
    .action(() => {
        execSync("node ./dist/src/index.js", { stdio: "inherit" }) 
    });

program.parse( process.argv );