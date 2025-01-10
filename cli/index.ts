import { execSync } from "child_process";

execSync("tsc --project tsconfig.cli.json", { stdio: "inherit" });