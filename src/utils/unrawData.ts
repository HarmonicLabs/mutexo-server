import type { RawData } from "ws";

export function unrawData( rawData: RawData ): Buffer
{
    rawData = rawData instanceof ArrayBuffer ? Buffer.from( rawData ) : rawData;
    return rawData instanceof Uint8Array ?
        Buffer.from( rawData ) :
        (
            Array.isArray( rawData ) ?
                Buffer.concat( rawData ) :
                Buffer.from([]) // never
        );
}