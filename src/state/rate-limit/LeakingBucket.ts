import { LEAKING_BUCKET_MAX_CAPACITY, LEAKING_BUCKET_TIME } from "../../constants";
import { logger } from "../../utils/Logger";

export interface LeakingBucketConfig {
    readonly capacity: number;
    readonly leakTime: number;
}

export const defaultLeakingBucketConfig: LeakingBucketConfig = Object.freeze({
    capacity: LEAKING_BUCKET_MAX_CAPACITY,
    leakTime: LEAKING_BUCKET_TIME
});

export class LeakingBucket
{
    constructor(
        readonly config: LeakingBucketConfig = { ...defaultLeakingBucketConfig }
    ) {}

    /**
     * ip => number of requests
     */
    readonly buckets = new Map<string, number>();

    get( ip: string ): number
    {
        let curr = this.buckets.get( ip );
        if( typeof curr !== "number" )
        {
            curr = 0;
            this.buckets.set( ip, curr );
        };
        return curr;
    }

    set( ip: string, n: number = 0 ): void
    {
        this.buckets.set( ip, n );
    }

    delete( ip: string ): void
    {
        this.buckets.delete( ip );
    }

    increment( ip: string ): boolean
    {
        const curr = this.get( ip );
        
        if( curr >= this.config.capacity ) return false;

        const next = curr + 1;
        this.set( ip, next );

        const self = this;

        let timeout: NodeJS.Timeout;
        timeout = setTimeout(
            () => self.decrement( ip ),
            this.config.leakTime
        );

        return true;
    }

    private decrement( ip: string ): void
    {
        if( !this )
        {
            logger.debug("decrement called with no this");
            return;
        }
        const curr = this.get( ip );
        const next = Math.max( 0, curr - 1 );
        this.set( ip, next );
    }
}

