import { AddressStr, Hash32, ITxOutRef, TxOut, TxOutRefStr, UTxO } from "@harmoniclabs/cardano-ledger-ts";
import { existsSync, mkdir, readFileSync, writeFileSync } from "fs";
import { dataToCbor, isData } from "@harmoniclabs/plutus-data";
import { UTXO_VALUE_PREFIX, UTXO_PREFIX } from "../constants";
import { followTestAddrs } from "../redis/isFollowingAddr";
import { getRedisClient } from "../redis/getRedisClient";
import { ValueJson } from "../types/UTxOWithStatus";
import { isAddrStr } from "../utils/isAddrStr";
import { isHex } from "../utils/isHex";

// ----- mutexo-tests support code -----
import dotenv from "dotenv";

let nearlyStartedUp: boolean = true;
const isTest: boolean = process.argv[3] === "true" || process.argv[3] === "undefined";
let toBeFollowedTestAddrs: number = process.argv[4] === "undefined" ? 2 : parseInt( process.argv[4] );

try{
    process.argv[2] !== "undefined" ? dotenv.config({ path: process.argv[2] }) : dotenv.config();
}
catch( err )
{
    throw new Error(`Error loading .env file (wrong path specified): ${err}`);
}

let envAddrsString: string;
let addressKeys: string[];
let testAddrs: { key: string, address: string }[];

if( isTest )
{
    envAddrsString = process.env.ADDRESSES || '';
    addressKeys = envAddrsString === '' ? [] : envAddrsString.split(',');
    testAddrs = addressKeys.length === 0 ? [] : addressKeys.map(( key ) => {
        const address = process.env[ key ];

        if( !address ) throw new Error(`Missing value for key: ${key}`);
        
        return { key, address };
    });
}
// -------------------------------------

export async function saveTxOut(
    out: TxOut, 
    ref: TxOutRefStr
): Promise<void>
{
	// --- mutexo-tests support code ---
    // it writes down txs caused by addresses listed into the .env file
    if( isTest && testAddrs.some(( testAddr ) => ( testAddr.address === out.address.toString() )) )
    {    
        const dirPath: string = './../test-txs';
        const filePath: string ='./../test-txs/test-txs.json';

        let newAddr = out.address.toString();

        if( !existsSync( dirPath ) ) 
        {
            await mkdir( dirPath, { recursive: true }, ( err ) => { console.log( err ) });
        }

        let parsed;

        if( nearlyStartedUp || !existsSync( filePath ) ) 
        {
            nearlyStartedUp = false;
            parsed = [];
        }
        else
        {
            const jsonString = readFileSync( filePath, "utf-8" );
            parsed = JSON.parse( jsonString );
        }

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

        writeFileSync( filePath, JSON.stringify( parsed, null, 2 ) );
    }
    // ------------------------

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