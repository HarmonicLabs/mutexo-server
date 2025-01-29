
import { dirname as getDirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MutexoServerConfig } from "../MutexoServerConfig/MutexoServerConfig";
import { QueryRequest } from "./MainWorkerQuery";
import { Worker } from "node:worker_threads";
import { logger } from "../utils/Logger";

const dirname = globalThis.__dirname ??
    getDirname( fileURLToPath( import.meta.url ) ) ??
    process.cwd();

/** interface used by the main program */
export class WssWorker
{
    nClients: number;
    readonly worker: Worker;
    readonly isTerminated: boolean = false;
    
    _workerListener: ( msg: QueryRequest, wssWorker: Worker ) => void;

    constructor(
        readonly cfg: MutexoServerConfig,
        readonly port: number
    )
    {
        this.nClients = 0;

        this.worker = new Worker(
            dirname + "/webSocketServer.js",
            { workerData: { cfg, port } }
        );

        const self = this;
        this._workerListener = () => {};

        this.isTerminated = false;
        this.worker.on("exit", () => { (this as any).isTerminated = true; });
        this.worker.on("error", ( err )=> {
            logger.error( "Error in WssWorker: ", err, "server", self.port );
            process.exit(1);
        });
    }

    terminate()
    {
        if(typeof this._workerListener === "function") this.worker.off("message", this._workerListener);
        if( !this.isTerminated ) return;
        this.worker.terminate();
        (this as any).isTerminated = true;
    }
}