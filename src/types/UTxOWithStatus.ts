import { AddressStr, NativeScript, PlutusScriptJsonFormat } from "@harmoniclabs/cardano-ledger-ts";

export type AssetJson = { [ name_hex: string ]: `${number}` };

export type ValueJson = { [ policy_hex: string ]: AssetJson };

export type RedisNativeScript = RedisScriptSignature | RedisScriptAll | RedisScriptAny | RedisScriptAtLeast | RedisScriptAfter | RedisScriptBefore;
export interface RedisScriptSignature extends RedisJSONObject {
    type: "sig";
    keyHash: string;
}
export interface RedisScriptAll extends RedisJSONObject {
    type: "all";
    scripts: RedisNativeScript[];
}
export interface RedisScriptAny extends RedisJSONObject {
    type: "any";
    scripts: RedisNativeScript[];
}
export interface RedisScriptAtLeast extends RedisJSONObject {
    type: "atLeast";
    required: `${number}`;
    scripts: RedisNativeScript[];
}
export interface RedisScriptAfter extends RedisJSONObject {
    type: "after";
    slot: `${number}`;
}
export interface RedisScriptBefore extends RedisJSONObject {
    type: "before";
    slot: `${number}`;
}

export interface RedisPlutusScriptJsonFormat<T extends "PlutusScriptV1" | "PlutusScriptV2" = "PlutusScriptV2"> extends RedisJSONObject {
    type: T,
    description: string | null,
    cborHex: string
}

export interface UTxOJson {
    address: AddressStr,
    value: ValueJson,
    datum: string | null
    refScript: RedisNativeScript | RedisPlutusScriptJsonFormat | null
}

export enum UTxOStatus {
    free = 0,
    blocked = 1,
    spent = 2
};

Object.freeze( UTxOStatus );

export interface RedisJSONArray extends Array<RedisJSON> {
}
export interface RedisJSONObject {
    [key: string]: RedisJSON;
    [key: number]: RedisJSON;
}
export type RedisJSON = null | boolean | number | string | Date | RedisJSONArray | RedisJSONObject;