const hexChars = Object.freeze(
    Array.from("0123456789abcdef")
)

export function isHex( str: string, len?: number ): boolean
{
    if( typeof len === "number" )
    {
        if(!(
            str.length === len
        )) return false;
    }

    const chars = Array.from( str.toLowerCase() )
    return chars.every( ch => hexChars.includes( ch ) );
}