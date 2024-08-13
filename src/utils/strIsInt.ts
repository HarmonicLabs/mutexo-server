export function strIsInt( str: string ): boolean
{
    let isInt = false;
    try{
        parseInt( str );
        isInt = true;
    } catch {};

    return isInt;
}