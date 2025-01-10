import { MutexoEventIndex } from "@harmoniclabs/mutexo-messages/dist/utils/constants";

export function eventIndexToMutexoEventName( evtIndex: number ): string
{
    const evtName = MutexoEventIndex[ evtIndex ];

    if( evtName !== undefined ) return evtName;
    else throw new Error( "Unknown event index: " + evtIndex );
}
