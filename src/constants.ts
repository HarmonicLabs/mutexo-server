export const MAX_N_VOLATILE_BLOCKS = 2160;
export const TIP_HASH_KEY  = "mutexo:tip:block_hash";
export const BLOCKS_QUEQUE_KEY = "mutexo:blocks_queque";
// export const ADDRS_SET_KEY = "mutexo:addrs_set";
export const ADDR_TO_API_SET_PREFIX = "mutexo:addr_to_api_set";
export const API_TO_ADDR_SET_PREFIX = "mutexo:api_to_addr_set";
export const BLOCK_PREFIX  = "mutexo:blk";
export const UTXO_PREFIX   = "mutexo:utxo";
export const UTXO_VALUE_PREFIX   = "mutexo:val";

// "lbrl" -> leaking bucket rate limit
export const LEAKING_BUCKET_BY_IP_PREFIX = "mutexo:lbrl";
export const LEAKING_BUCKET_TIME = 60_000;
export const LEAKING_BUCKET_MAX_CAPACITY = 20;

export const TEMP_AUTH_TOKEN_PREFIX = "auth:temp_token";

// TO CHANGE, IT REFERS TO AN UNIQUE API KEY COMMON TO ALL THE CLIENTS
export const PUBLIC_API_KEY = "public_api_key";