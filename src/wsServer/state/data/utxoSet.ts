import { AddressStr, TxOutRefStr } from "@harmoniclabs/cardano-ledger-ts";


/**
 * map from TxOutRefStr to the resolved tx out (serialized in cbor)
 */
export const utxoSet = new Map<TxOutRefStr, Uint8Array>();

/**
 * allows to quickly find the utxos of an address
 */
export const addrUtxoIndex = new Map<AddressStr, Set<TxOutRefStr>>();