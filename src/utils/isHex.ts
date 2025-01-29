const hexChars = Object.freeze(
    Array.from("0123456789abcdef")
)

export function isHex( str: string ): boolean
{
    // test using regex
    return /^[0-9a-fA-F]+$/.test( str );
}