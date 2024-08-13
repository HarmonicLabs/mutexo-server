import { Address, AddressStr } from "@harmoniclabs/cardano-ledger-ts";

export function isAddrStr( thing: any ): thing is AddressStr
{
    if( typeof thing !== "string" ) return false;

    try {
        Address.fromString( thing );
        return true;
    } catch {
        return false;
    }
}