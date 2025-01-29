import { AddressStr, TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { ClientSubs, createClientSubs } from "./ClientSubs";
import { getWsClientIp, setWsClientIp } from "./clientProps";
import type { WebSocket } from "ws";
import { LockerInfo } from "../state/mutex/mutex";

export class Client
    implements ClientSubs
{
    // readonly mutex: Set<TxOutRefStr>;
    readonly utxoFree: Set<TxOutRefStr>;
    readonly utxoLock: Set<TxOutRefStr>;
    readonly utxoSpent: Set<TxOutRefStr>;
    readonly addrFree: Set<AddressStr>;
    readonly addrLock: Set<AddressStr>;
    readonly addrSpent: Set<AddressStr>;
    readonly addrOut: Set<AddressStr>;

    readonly lockedUtxos: Set<TxOutRefStr>;

    get ip(): string
    {
        if( typeof this._ip !== "string" )
        {
            this._ip = getWsClientIp( this.ws );
        }
        return this._ip;
    }

    constructor(
        readonly ws: WebSocket,
        private _ip: string
    )
    {
        const {
            // mutex,
            utxoFree,
            utxoLock,
            utxoSpent,
            addrFree,
            addrLock,
            addrSpent,
            addrOut,
        } = createClientSubs();

        // this.mutex = mutex;
        this.utxoFree = utxoFree;
        this.utxoLock = utxoLock;
        this.utxoSpent = utxoSpent;
        this.addrFree = addrFree;
        this.addrLock = addrLock;
        this.addrSpent = addrSpent;
        this.addrOut = addrOut;
    }

    getLockerInfo( port: number ): LockerInfo
    {
        return {
            clientIp: this.ip,
            serverPort: port
        };
    }

    static fromWs( ws: WebSocket, ip?: string ): Client
    {
        if( typeof ip === "string" )
        {
            setWsClientIp( ws, ip );
        }
        if(!((ws as any).MUTEXO_CLIENT_INSTANCE instanceof Client))
        {
            (ws as any).MUTEXO_CLIENT_INSTANCE = new Client(
                ws,
                getWsClientIp( ws )
            );
        }
        return (ws as any).MUTEXO_CLIENT_INSTANCE as Client;
    }

    // https://github.com/websockets/ws/issues/2076#issuecomment-1250354722
    send(data: BufferLike, cb?: (err?: Error) => void): void
    send(
        data: BufferLike,
        options: {
            mask?: boolean | undefined;
            binary?: boolean | undefined;
            compress?: boolean | undefined;
            fin?: boolean | undefined;
        },
        cb?: (err?: Error) => void,
    ): void
    send( ...args: any[] ): void
    {
        return (this.ws.send as any)( ...args );
    }

    terminate(): void
    {
        return this.ws.terminate();
    }
}

// can not get all overload of BufferConstructor['from'], need to copy all it's first arguments here
// https://github.com/microsoft/TypeScript/issues/32164
type BufferLike =
    | string
    | Buffer
    | DataView
    | number
    | ArrayBufferView
    | Uint8Array
    | ArrayBuffer
    | SharedArrayBuffer
    | readonly any[]
    | readonly number[]
    | { valueOf(): ArrayBuffer }
    | { valueOf(): SharedArrayBuffer }
    | { valueOf(): Uint8Array }
    | { valueOf(): readonly number[] }
    | { valueOf(): string }
    | { [Symbol.toPrimitive](hint: string): string };