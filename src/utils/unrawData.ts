import type { RawData } from "ws";

export function unrawData( rawData: RawData ): Buffer
{
    return rawData instanceof Uint8Array || rawData instanceof ArrayBuffer ?
        Buffer.from( rawData ) :
        (
            Array.isArray( rawData ) ?
                Buffer.concat( rawData ) :
                Buffer.from([]) // never
        );
}