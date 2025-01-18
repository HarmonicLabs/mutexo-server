import { EvtKey, EvtManager } from "../wsServer/EvtManager";

// export const mutex = new EvtManager("mutex", EvtKey.TxOutRefStr);
export const utxoFree = new EvtManager("utxoFree", EvtKey.TxOutRefStr);
export const utxoLock = new EvtManager("utxoLock", EvtKey.TxOutRefStr);
export const utxoSpent = new EvtManager("utxoSpent", EvtKey.TxOutRefStr);
export const addrFree = new EvtManager("addrFree", EvtKey.AddressStr);
export const addrLock = new EvtManager("addrLock", EvtKey.AddressStr);
export const addrSpent = new EvtManager("addrSpent", EvtKey.AddressStr);
export const addrOut = new EvtManager("addrOut", EvtKey.AddressStr);