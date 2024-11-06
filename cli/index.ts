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
    .action(() => {
        execSync("node ./dist/src/index.js", { stdio: "inherit" }) 
    });

program.parse( process.argv );