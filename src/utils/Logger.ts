

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4
}

Object.freeze( LogLevel );

export type LogLevelString = keyof typeof LogLevel & string;

export function isLogLevelString( str: string ): str is LogLevelString
{
    return (
        typeof str === "string" &&
        typeof LogLevel[str.toUpperCase() as any] === "number"
    );
}

export function logLevelFromString( str: string ): LogLevel
{
    if( typeof str !== "string" ) return LogLevel.INFO;
    return (
        LogLevel[str.toUpperCase() as any] as any as LogLevel | undefined
    ) ?? LogLevel.INFO;
}

export interface LoggerConfig {
    logLevel: LogLevel;
}

const defaultLoggerConfig: LoggerConfig = {
    logLevel: LogLevel.INFO
};

export class Logger
{
    private static globalConfig: LoggerConfig = Object.freeze({ logLevel: LogLevel.ERROR });

    private config: LoggerConfig = { ...defaultLoggerConfig };

    constructor( config?: Partial<LoggerConfig> )
    {
        this.config = {
            ...defaultLoggerConfig,
            ...config
        };
    }

    get logLevel()
    {
        return Math.min( this.config.logLevel, Logger.globalConfig.logLevel );
    }

    canDebug(): boolean
    {
        return this.logLevel <= LogLevel.DEBUG;
    }
    canInfo(): boolean
    {
        return this.logLevel <= LogLevel.INFO;
    }
    canWarn(): boolean
    {
        return this.logLevel <= LogLevel.WARN;
    }
    canError(): boolean
    {
        return this.logLevel <= LogLevel.ERROR;
    }

    setLogLevel( level: LogLevel )
    {
        this.config.logLevel = level;
    }

    debug( ...stuff: any[] )
    {
        if( this.canDebug() ) console.log( ...stuff );
    }
    log( ...stuff: any[] )
    {
        if( this.canInfo() ) console.log( ...stuff );
    }
    info( ...stuff: any[] )
    {
        if( this.canInfo() ) console.info( ...stuff );
    }
    warn( ...stuff: any[] )
    {
        if( this.canWarn() ) console.warn( ...stuff );
    }
    error( ...stuff: any[] )
    {
        if( this.canError() ) console.error( ...stuff );
    }
}

export const logger = new Logger({ logLevel: LogLevel.DEBUG });