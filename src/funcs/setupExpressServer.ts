import { AddressStr, TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { toHex } from "@harmoniclabs/uint8array-utils";
import { wsAuthIpRateLimit, generalRateLimit, ensureJson } from "../middlewares/ip";
import { isTxOutRefStr } from "../utils/isTxOutRefStr";
import { logger } from "../utils/Logger";
import { SharedAddrStr } from "../utils/SharedAddrStr";
import { WssWorker } from "../wssWorker/WssWorker";
import express from "express";
import { getClientIp as getClientIpFromReq } from "request-ip";
import { AppState } from "../state/AppState";
import { MutexoServerConfig } from "../MutexoServerConfig/MutexoServerConfig";
import getPort from "get-port";

export async function setupExpressServer( cfg: MutexoServerConfig, state: AppState, servers: WssWorker[] )
{
    const app = express();
    app.use( express.json() );
    app.set("trust proxy", 1);

    app.get("/wsAuth", wsAuthIpRateLimit, async ( req, res ) => {
        const ip = getClientIpFromReq( req );
        if(typeof ip !== "string")
        {
            res.status(400).send("invalid ip");
            return;
        }
        
        if( state.authTokens.has( ip ) )
        {
            res
            .status(400)
            .send("already authenticated");
            return;
        }

        let expectedServer: WssWorker = servers[0];
        for( const server of servers )
        {
            if( server.nClients < expectedServer.nClients )
            {
                expectedServer = server;
            }
        }

        const token = state.getNewAuthToken( ip, expectedServer );

        res
        .status(200)
        .type("application/json")
        .send({ token, port: expectedServer.port });
    });

    /**
    app.get("/addrs", generalRateLimit, async ( req, res ) => {
        res
        .status(200)
        .type("application/json")
        .send( cfg.addrs );
    });

    app.get("/addrs/:addr/utxos", generalRateLimit, async ( req, res ) =>
    {
        const addr = req.params.addr;
        if(!( typeof addr === "string" ))
        {
            res
            .status(400)
            .send({ err: "invalid request; address not string" });
            return;
        }

        const shared = SharedAddrStr.getIfExists( addr as AddressStr );
        if( !shared || !state.isFollowing( shared ) )
        {
            res
            .status(400)
            .send({ err: "address not followed" });
            return;
        }

        const refs = state.chain.addrUtxoIndex.get( shared );
        if( !refs )
        {
            res
            .status(400)
            .send({ err: "address not followed" });
            return;
        }

        res
        .status(200)
        .type("application/json")
        .send([ ...refs ]);
        return;
    });

    app.get("/resolve", generalRateLimit, ensureJson, async ( req, res ) => {
        const refs = req.body as TxOutRefStr[];
        if(!(
            Array.isArray( refs ) &&
            refs.every( isTxOutRefStr )
        ))
        {
            res
            .status(400)
            .send({ err: "invalid request body; tx out ref strings expected with '#' as separator" });
            return;
        }

        if( refs.length <= 0 )
        {
            res
            .status(200)
            .send([]);
            return;
        }

        if( refs.length > 20 )
        {
            res
            .status(400)
            .send({ err: "request too big; try with less utxos per request; limit is 20" });
            return;
        }

        const resolved = state.chain.resolveUtxos( refs );
        const result = new Array( resolved.length );
        let len = 0;

        // map to hex and filter out undefined
        for( const { ref, out } of resolved )
        {
            if(!( out instanceof Uint8Array )) continue;
            result[ len++ ] = {
                ref,
                out: toHex( out )
            };
        }

        result.length = len;
        res
        .status(200)
        .type("application/json")
        .send( result );
        return;
    });
    //*/

    const realPort = await getPort({ port: cfg.httpPort, exclude: servers.map( s => s.port ) });
    app.listen( realPort, () => {
        logger.info(`Mutexo http server listening at http://localhost:${realPort}`);
    });

}