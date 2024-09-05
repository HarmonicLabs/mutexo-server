import { ClientReq, ClientReqFree, ClientReqLock, ClientSub, ClientUnsub } from "@harmoniclabs/mutexo-messages";

export function reqToName( msg: ClientReq ): string | undefined
{
    if( msg instanceof ClientSub )          return "sub";
    if( msg instanceof ClientUnsub )        return "unsub";
    if( msg instanceof ClientReqFree )      return "free";
    if( msg instanceof ClientReqLock )      return "lock";

    return undefined;
}
