import { AddressStr, TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";

export interface MutexEventInfos {
    ref: TxOutRefStr,
    addr: AddressStr
}