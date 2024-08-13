export function isNonEmptyArray( stuff: any ): stuff is [ any, ...any[] ]
{
    return Array.isArray( stuff ) && stuff.length >= 1;
}

export function isNonEmptySet( stuff: any ): boolean
{
    return stuff instanceof Set && stuff.size >= 1;
}