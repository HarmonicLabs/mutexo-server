import { AddressStr, Hash32, ITxOutRef, TxOut, TxOutRefStr, UTxO } from "@harmoniclabs/cardano-ledger-ts";
import { dataToCbor, isData } from "@harmoniclabs/plutus-data";
import { UTXO_VALUE_PREFIX, UTXO_PREFIX } from "../constants";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { followTestAddrs } from "../redis/isFollowingAddr";
import { getRedisClient } from "../redis/getRedisClient";
import { ValueJson } from "../types/UTxOWithStatus";
import { isAddrStr } from "../utils/isAddrStr";
import { isHex } from "../utils/isHex";

//debug
let nearlyStartedUp: boolean = true;
let toBeFollowedTestAddrs: number = 1;

export async function saveTxOut(
    out: TxOut, 
    ref: TxOutRefStr
): Promise<void>
{
	//--- test ---
    mkdirSync("./../mutexo-tests-objs", { recursive: true });
	const jsonString = readFileSync("./../mutexo-tests-objs/mutexoTestPreviewTransactions.json", "utf-8");
	let parsed;

	try
	{
		parsed = JSON.parse( jsonString );
	}
	catch
	{
		parsed = [];
	}
	
    if( nearlyStartedUp ) 
	{
        nearlyStartedUp = false;
		parsed = [];
    }

	let newAddr = out.address.toString() as AddressStr;
	let newUtxoRef = {
		id: ref.split("#")[0],
		index: parseInt(ref.split("#")[1])
	} as ITxOutRef;

	if( toBeFollowedTestAddrs-- > 0 )
	{
		await followTestAddrs( [ newAddr ] );
	}
	
	parsed.push({
		addr: newAddr,
		utxoRef: newUtxoRef
	});

	writeFileSync(
		"./../mutexo-tests-objs/mutexoTestPreviewTransactions.json", 
		JSON.stringify( parsed, null, 2 )
	);
	//-----------

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