import { AddressStr, TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";

export interface IMutexoInputJson {
    addr: AddressStr;
    ref: TxOutRefStr;
    txHash: string;
}

export interface IMutexoOutputJson {
    addr: AddressStr;
    ref: TxOutRefStr;
};