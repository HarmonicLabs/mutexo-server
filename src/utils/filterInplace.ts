export function filterInplace<T>( arr: T[], shouldKeep: ( elem: T, i: number ) => boolean ): void
{
    for( let i = 0; i < arr.length; )
    {
        if( shouldKeep( arr[i], i ) )
        {
            i++;
        }
        else
        {
            void arr.splice( i, 1 );
        }
    }
}

export async function filterInplaceAsync<T>( arr: T[], shouldKeep: ( elem: T, i: number ) => Promise<boolean> ): Promise<void>
{
    const results = await Promise.all( arr.map( shouldKeep ) );
    filterInplace( arr, (_, i) => results[i] );
}