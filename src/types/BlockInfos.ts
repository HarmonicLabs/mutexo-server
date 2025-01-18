import { TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";
import { isTxOutRefStr } from "../utils/isTxOutRefStr";
import { isObject } from "@harmoniclabs/obj-utils";
import { isHex } from "../utils/isHex";

export interface TxIO {
    ins : TxOutRefStr[],
    outs: TxOutRefStr[]
}

export function isTxIO( stuff: any ): stuff is TxIO
{
    return isObject( stuff ) && (
        Array.isArray( stuff.ins ) &&
        (stuff.ins as any[]).every( isTxOutRefStr ) &&

        Array.isArray( stuff.outs ) &&
        (stuff.outs as any[]).every( isTxOutRefStr )
    );
}

export interface BlockInfos{
    slot: number,
    prev: string,
    txs: TxIO[]
}

export interface BlockInfosWithHash extends BlockInfos {
    hash: string
}

export function tryGetBlockInfos( stuff: any ): BlockInfos | undefined
{
    if(!(
        isObject( stuff ) &&
        typeof stuff.slot === "number" &&
        // strIsInt( stuff.slot ) &&
        isHex( stuff.prev ) &&
        Array.isArray( stuff.txs ) &&
        (stuff.txs as any[]).every( isTxIO )
    )) return undefined;

    return {
        slot: Number( stuff.slot ),
        prev: stuff.prev,
        txs: stuff.txs
    };
}