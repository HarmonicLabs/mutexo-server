import { TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { isHex } from "./isHex";
import { strIsInt } from "./strIsInt";

export function isTxOutRefStr( str: any ): str is TxOutRefStr
{
    if( typeof str !== "string" ) return false;
    
    const [ hash, idx, ...rest ] = str.split("#");

    return (
        rest.length === 0 &&
        strIsInt( idx ) &&
        isHex( hash, 64 )
    );
}