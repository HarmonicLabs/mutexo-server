import { Address, AddressStr } from "@harmoniclabs/cardano-ledger-ts";

const sharedAddrs = new Map<AddressStr, SharedAddrStr>();

// mainly because we remember many utxos with the same address
export class SharedAddrStr
{
    readonly addr: AddressStr;

    constructor( addr: AddressStr )
    {
        this.addr = addr;
    }

    valueOf(): AddressStr { return this.addr; }
    toString(): AddressStr { return this.addr; }
    toAddress(): Address { return Address.fromString( this.addr ); }

    static get( addr: AddressStr | SharedAddrStr ): SharedAddrStr
    {
        if( addr instanceof SharedAddrStr ) return addr;
        let sharedAddr = sharedAddrs.get( addr );
        if( !sharedAddr )
        {
            sharedAddrs.set(
                addr,
                sharedAddr = new SharedAddrStr( addr )
            );
        }
        return sharedAddr;
    }

    static getIfExists( addr: AddressStr | SharedAddrStr ): SharedAddrStr | undefined
    {
        if( addr instanceof SharedAddrStr ) return addr;
        return sharedAddrs.get( addr );
    }

    static forget( addr: AddressStr | SharedAddrStr ): void
    {
        addr = addr.toString() as AddressStr;
        sharedAddrs.delete( addr );
    }
    // use(): SharedAddrStr { (this as any).refs++; return this; }
    // forget(): void { (this as any).refs--; }
}