/* 
ev: APIGatewayProxyEvent, ctx: Context, rctx: ProtectedReqCtx 
*/
export interface HTTPCORSOptions {
    /** Allow origins */
    origins?: string[] | "*";
    allowHeaders?: string[];
    exposeHeaders?: string[];
    maxAge?: number;
    allowCredentials?: boolean;
}

export type HTTPSetCookie = {
    name: string;
    value: string;
    expires?: Date;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
};

/**
 * The interface for the HTTP request
 *
 * Use module augmentation to extend this
 * */
export interface HTTPRequest {}

/**
 * The interface for the HTTP response
 *
 * Use module augmentation to extend this */
export interface HTTPResponse {}

/**
 * Custom context for the HTTP request
 *
 * Use module augmentation to extend this
 * */
export interface HTTPRequestContext {}

/**
 * Custom session for the HTTP request
 */
export interface HTTPSession {}

export type HTTPNormalizedRequest = {
    originalRequest: HTTPRequest;
    method: string;
    path: string;
    body: any;
    searchParams: URLSearchParams;
    headers: Headers;
    cookies: Record<string, string>;
    context?: HTTPRequestContext;
    session?: HTTPSession;
};

export type HTTPNormalizedResponse = {
    headers?: Headers;
    body?: any;
    status?: number;
    cookies?: HTTPSetCookie[];
};

export type HTTPRequestParser = (request: HTTPNormalizedRequest) => Partial<HTTPNormalizedRequest> | void;

export type HTTPHandler = (request: HTTPNormalizedRequest) => HTTPNormalizedResponse;

export type HTTPResponseRefiner = (
    request: HTTPNormalizedRequest,
    response: HTTPNormalizedResponse
) => HTTPNormalizedResponse;

export type HTTPSender = (request: HTTPNormalizedRequest, response: HTTPNormalizedResponse) => HTTPResponse;

export type HTTPCORSResolver = (request: HTTPNormalizedRequest) => HTTPCORSOptions | undefined;

export type HTTPMatcher = string | RegExp | (string | RegExp)[];
