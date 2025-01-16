import { AddressStr, TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { ClientSubs, createClientSubs } from "./ClientSubs";
import { getWsClientIp } from "./clientProps";
import type { WebSocket } from "ws";

export class Client
    implements ClientSubs
{
    readonly mutex: Set<TxOutRefStr>;
    readonly utxoFree: Set<TxOutRefStr>;
    readonly utxoLock: Set<TxOutRefStr>;
    readonly utxoSpent: Set<TxOutRefStr>;
    readonly addrFree: Set<AddressStr>;
    readonly addrLock: Set<AddressStr>;
    readonly addrSpent: Set<AddressStr>;
    readonly addrOut: Set<AddressStr>;

    constructor(
        readonly ws: WebSocket,
        public ip: string,
    )
    {
        const {
            mutex,
            utxoFree,
            utxoLock,
            utxoSpent,
            addrFree,
            addrLock,
            addrSpent,
            addrOut,
        } = createClientSubs();

        this.mutex = mutex;
        this.utxoFree = utxoFree;
        this.utxoLock = utxoLock;
        this.utxoSpent = utxoSpent;
        this.addrFree = addrFree;
        this.addrLock = addrLock;
        this.addrSpent = addrSpent;
        this.addrOut = addrOut;
    }

    static fromWs( ws: WebSocket ): Client
    {
        // return new Client( ws, getWsClientIp( ws ) );
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