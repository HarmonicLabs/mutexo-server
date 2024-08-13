import { AddressStr, TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";

export interface MainToWsEvt {
    type: "Spent" | "Output",
    data: {
        ref: TxOutRefStr,
        resolved: {
            address: AddressStr,
            value: any,
            datum: any,
            redScript: any
        }
    }
}

export type MainToWsMsgs = MainToWsEvt[];

export type WsToMainMsg = any;