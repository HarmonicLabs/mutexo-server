import { AddressStr, TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { Client } from "./Client";
import { ClientSubsName, isClientSubsName } from "./ClientSubs";

export enum EvtKey {
    TxOutRefStr,
    AddressStr
}
Object.freeze(EvtKey);

function isEventKeyType( thing: any ): thing is EvtKey
{
    return (
        typeof thing === "number" &&
        typeof EvtKey[ thing ] === "string"
    );
}

export type EvtKeyType<EK extends EvtKey> =
    EK extends EvtKey.TxOutRefStr ? TxOutRefStr :
    EK extends EvtKey.AddressStr ? AddressStr :
    never;

export class EvtManager<EK extends EvtKey>
{
    readonly clients: Map<EvtKeyType<EK>, Set<Client>>;

    constructor(
        readonly evtName: ClientSubsName,
        readonly evtKey: EK
    )
    {
        if( !isClientSubsName( evtName ) ) throw new Error( "Invalid evtName" );
        if( !isEventKeyType( evtKey ) ) throw new Error( "Invalid evtKey" ); 

        this.clients = new Map();
    }

    emitToKey( key: EvtKeyType<EK>, data: Uint8Array ): void
    {
        const subs = this.clients.get( key );
        if( !subs ) return;

        for( const client of subs ) client.ws.send( data );
    }

    sub( key: EvtKeyType<EK>, client: Client ): void
    {
        let subs = this.clients.get( key );
        if( !subs )
        {
            subs = new Set();
            this.clients.set( key, subs );
        }

        subs.add( client );

        client[ this.evtName ].add( key as any );
    }
    
    unsub( key: EvtKeyType<EK>, client: Client ): void
    {
        client[ this.evtName ].delete( key as any );

        const subs = this.clients.get( key );
        if( !subs ) return;

        subs.delete(client);

        if( subs.size === 0 ) this.clients.delete(key);
    }

    unsubClient( client: Client ): void
    {
        const subs = client[ this.evtName ];
        for( const key of subs ) this.unsub( key as any, client );
    }
}