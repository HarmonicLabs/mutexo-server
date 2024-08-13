import { AddressStr, Hash32, TxOut, TxOutRef, TxOutRefStr, UTxO } from "@harmoniclabs/cardano-ledger-ts";
import { getRedisClient } from "../redis/getRedisClient";
import { dataToCbor, isData } from "@harmoniclabs/plutus-data";
import { UTXO_VALUE_PREFIX, UTXO_PREFIX } from "../constants";
import { ValueJson, UTxOStatus } from "../types/UTxOWithStatus";
import { isAddrStr } from "../utils/isAddrStr";
import { isHex } from "../utils/isHex";

export async function saveTxOut(
    out: TxOut, 
    ref: TxOutRefStr
): Promise<void>
{
    const redis = await getRedisClient();

    await Promise.all([
        redis.json.set( `${UTXO_VALUE_PREFIX}:${ref}`, "$", out.value.toJson() as ValueJson ),
        redis.hSet(
            `${UTXO_PREFIX}:${ref}`,
            {
                // ref,
                addr: out.address.toString(),
                dat_hash: out.datum instanceof Hash32 ? out.datum.toString() : 0,
                inl_dat: isData( out.datum ) ? dataToCbor( out.datum ).toString() : 0,
                ref_script: out.refScript?.toCbor().toString() ?? 0,
                spent: 0
            }
        )
    ]);
}

export interface SavedTxOut {
    addr: AddressStr,
    dat_hash: string | null,
    inl_dat: string | null,
    ref_script: string | null,
    spent: boolean
}

export interface SavedFullTxOut extends SavedTxOut {
    value: ValueJson
}

export function tryParseSavedTxOut( saved: { [x: string]: string } ): SavedTxOut | undefined
{
    if( !isAddrStr( saved.addr ) ) return undefined;

    return {
        addr: saved.addr,
        dat_hash: isHex( saved.dat_hash, 64 ) ? saved.dat_hash : null,
        inl_dat: isHex( saved.inl_dat ) ? saved.inl_dat : null,
        ref_script: isHex( saved.ref_script ) ? saved.ref_script : null,
        spent: saved.spent !== "0"
    };
}

export async function saveUtxos( utxos: UTxO[] ): Promise<void>
{
    void await Promise.all(
        utxos.map( u => 
            saveTxOut(
                u.resolved,
                u.utxoRef.toString()
            )
        )
    );
}