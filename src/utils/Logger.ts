

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4
}

Object.freeze( LogLevel );

export interface LoggerConfig {
    logLevel: LogLevel;
}

const defaultLoggerConfig: LoggerConfig = {
    logLevel: LogLevel.INFO
};

export class Logger
{
    private static globalConfig: LoggerConfig = Object.freeze({ logLevel: LogLevel.ERROR });

    private config: LoggerConfig = defaultLoggerConfig;

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

    static setLogLevel( level: LogLevel )
    {
        Logger.globalConfig.logLevel = level;
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
    warn( ...stuff: any[] )
    {
        if( this.canWarn() ) console.warn( ...stuff );
    }
    error( ...stuff: any[] )
    {
        if( this.canError() ) console.error( ...stuff );
    }
}