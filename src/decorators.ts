import { Role, ServiceCtr, ServicePrototype, Shadow } from "../../njses";
import { HTTP_FIELD, HTTP_ROLE } from "./const";
import type {
    HTTPCORSOptions,
    HTTPRequestContext,
    HTTPSession,
    HTTPNormalizedRequest,
    HttpServiceOptions,
    HTTPMatcherCheck,
    HTTPNormalizedResponse,
    HTTPResponse,
} from "./types";

/**
 * Assigns the HTTP role to the given service
 * @class_decorator
 */
export function HTTP(options: HttpServiceOptions = {}) {
    return function (service: ServiceCtr) {
        Shadow.update(service, (shadow) => {
            shadow.$http_options = options;
        });
        return Role(HTTP_ROLE.SERVICE)(service);
    };
}

/**
 * Restricts the method or the http service to the given matcher
 * @class_decorator
 * @method_decorator
 */
export function HTTPMatcher(matcher: HTTPMatcherCheck) {
    return function (service: any, propertyKey?: string, descriptor?: PropertyDescriptor) {
        if (descriptor) {
            Shadow.addField(service, propertyKey as string, { $http_matcher: matcher });
        } else
            Shadow.update(service, (shadow) => {
                shadow.$http_matcher = matcher;
            });
    };
}

export type CORS = (request: HTTPNormalizedRequest) => HTTPCORSOptions | undefined;

/**
 * @class_decorator
 * @method_decorator
 */
export function CORS(options: HTTPCORSOptions) {
    return function (target: any, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) {
        // CORS Handler based
        if (propertyKey) {
            Shadow.addProp(target, HTTP_FIELD.CORS, propertyKey);
        }
        // CORS Class based
        else {
            Shadow.update(target, (shadow) => {
                shadow.$http_cors = options;
            });
        }
    };
}

// - handlers

export type Handler = (request: HTTPNormalizedRequest) => HTTPNormalizedResponse;

/**
 * @method_decorator
 */
export function Handler(httpMethod: string = "GET", path: string = "") {
    return function (service: ServicePrototype, propertyKey: string, descriptor: PropertyDescriptor) {
        Shadow.addField(service, propertyKey, { $http_method: httpMethod, $http_path: path, method: true });
    };
}

/**
 * @method_decorator
 */
export const POST = (path: string = "") => Handler("POST", path);

/**
 * @method_decorator
 */
export const PUT = (path: string = "") => Handler("PUT", path);

/**
 * @method_decorator
 */
export const GET = (path: string = "") => Handler("GET", path);

/**
 * @method_decorator
 */
export const DELETE = (path: string = "") => Handler("DELETE", path);

// -- Parameters

/**
 * @param_decorator
 */
export function Body<B>(target: ServicePrototype, propertyKey: string | symbol, parameterIndex: number) {
    Shadow.addParam(target, propertyKey, parameterIndex, {$http_param_type: "body" });
}

/**
 * @param_decorator
 */
export function Search<S extends URLSearchParams>(
    target: ServicePrototype,
    propertyKey: string | symbol,
    parameterIndex: number
) {
    Shadow.addParam(target, propertyKey, parameterIndex, { $http_param_type: "search_params" });
}

/**
 * @param_decorator
 */
export function Request<R>(target: ServicePrototype, propertyKey: string | symbol, parameterIndex: number) {
    Shadow.addParam(target, propertyKey, parameterIndex, { $http_param_type: "req" });
}

/**
 * @param_decorator
 */
export function Headers<H extends Headers>(
    target: ServicePrototype,
    propertyKey: string | symbol,
    parameterIndex: number
) {
    Shadow.addParam(target, propertyKey, parameterIndex, { $http_param_type: "headers" });
}

// -- Parsers

export type Parser = (request: HTTPNormalizedRequest) => Partial<HTTPNormalizedRequest> | void;

export type Receive = Parser;

/**
 * Parses the request initially.
 * @method_decorator
 */
export function Receive(target: ServicePrototype, propertyKey: string, descriptor: PropertyDescriptor) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_RECEIVE, propertyKey);
}

export type Middleware = Parser;

/**
 * Transforms the request.
 * @method_decorator
 */
export function Middleware(target: ServicePrototype, propertyKey: string, descriptor: PropertyDescriptor) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
}

export type BodyParser = (request: HTTPNormalizedRequest) => any;

/**
 * **Be careful! The decorated method will be modified and will return a `HTTPNormalizedRequest`**.
 * @method_decorator
 */
export function BodyParser(target: ServicePrototype, propertyKey: string, descriptor: PropertyDescriptor) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
    const originalMethod = descriptor.value;
    descriptor.value = async function (request: HTTPNormalizedRequest) {
        const body = await originalMethod.apply(this, [request]);
        if (body === undefined) return request;
        return { ...request, body };
    };
}

export type CookieParser = (
    request: HTTPNormalizedRequest
) => Record<string, string> | Promise<Record<string, string>>;

/**
 * **Be careful! the decorated method will be modified and will return a `HTTPNormalizedRequest`**.
 * @method_decorator
 */
export function CookieParser(target: ServicePrototype, propertyKey: string, descriptor: PropertyDescriptor) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
    const originalMethod = descriptor.value;
    descriptor.value = async function (request: HTTPNormalizedRequest) {
        const cookies = await originalMethod.apply(this, [request]);
        return { ...request, cookies: cookies };
    };
}

export type SearchParser = (request: HTTPNormalizedRequest) => URLSearchParams | Promise<URLSearchParams>;

/**
 * **Be careful! The decorated method will be modified and will return a `HTTPNormalizedRequest`**.
 * @method_decorator
 */
export function SearchParser(target: ServicePrototype, propertyKey: string, descriptor: PropertyDescriptor) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
    const originalMethod = descriptor.value;
    descriptor.value = async function (request: HTTPNormalizedRequest) {
        const search = await originalMethod.apply(this, [request]);
        return { ...request, search };
    };
}

export type HeadersParser = (request: HTTPNormalizedRequest) => Headers | Promise<Headers>;

/**
 * **Be careful! The decorated method will be modified and will return a `HTTPNormalizedRequest`**.
 * @method_decorator
 */
export function HeadersParser(target: ServicePrototype, propertyKey: string, descriptor: PropertyDescriptor) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
    const originalMethod = descriptor.value;
    descriptor.value = async function (request: HTTPNormalizedRequest) {
        const headers = await originalMethod.apply(this, [request]);
        return { ...request, headers };
    };
}

export type ContextProvider = (
    request: HTTPNormalizedRequest
) => HTTPRequestContext | Promise<HTTPRequestContext>;

/**
 * **Be careful! The decorated method will be modified and will return a `HTTPNormalizedRequest`**.
 * @method_decorator
 */
export function ContextProvider(
    target: ServicePrototype,
    propertyKey: string,
    descriptor: PropertyDescriptor
) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
    const originalMethod = descriptor.value;
    descriptor.value = async function (request: HTTPNormalizedRequest) {
        const context = await originalMethod.apply(this, [request]);
        return { ...request, context };
    };
}

export type SessionProvider = (request: HTTPNormalizedRequest) => HTTPSession | Promise<HTTPSession>;

/**
 * The decorated method should throw an Error if any authentication fails.
 *
 * **Be careful, the decorated method will be modified and will return a `HTTPNormalizedRequest`**.
 * @method_decorator
 */
export function SessionProvider(
    target: ServicePrototype,
    propertyKey: string,
    descriptor: PropertyDescriptor
) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
    const originalMethod = descriptor.value;
    descriptor.value = async function (request: HTTPNormalizedRequest) {
        const session = await originalMethod.apply(this, [request]);
        return { ...request, session };
    };
}

// -- Refine

export type Refine = (
    request: HTTPNormalizedRequest,
    response: HTTPNormalizedResponse
) => HTTPNormalizedResponse;

/**
 * Refines a response before sending it
 * @method_decorator
 */
export function Refine<R extends Refine>(
    target: ServicePrototype,
    propertyKey: string,
    descriptor: PropertyDescriptor
) {
    Shadow.addMethod(target, HTTP_FIELD.RESPONSE_REFINER, propertyKey);
}

// -- Send

export type Send = (
    request: HTTPNormalizedRequest,
    response: HTTPNormalizedResponse
) => HTTPResponse | Promise<HTTPResponse>;

/**
 * Refines a response before sending it
 * @method_decorator
 */
export function Send(target: ServicePrototype, propertyKey: string, descriptor: PropertyDescriptor) {
    Shadow.addMethod(target, HTTP_FIELD.SENDER, propertyKey);
}
