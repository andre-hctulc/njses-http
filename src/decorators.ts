import { Role, ServiceCtr, ServicePrototype, Shadow } from "../../njses";
import { HTTP_FIELD, HTTP_ROLE } from "./const";
import type {
    HTTPCORSOptions,
    HTTPRequestContext,
    HTTPRequestParser,
    HTTPResponseRefiner,
    HTTPSender,
    HTTPSession,
    HTTPNormalizedRequest,
    HttpServiceOptions,
    HTTPMatcherCheck,
} from "./types";

/**
 * Assigns the HTTP role to the given service
 * @class_decorator
 */
export function HTTP(options: HttpServiceOptions = {}) {
    return function (service: ServiceCtr) {
        Shadow.update(service, (shadow) => {
            shadow.http_options = options;
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
            Shadow.addField(service, propertyKey as string, { http_matcher: matcher });
        } else
            Shadow.update(service, (shadow) => {
                shadow.http_matcher = matcher;
            });
    };
}

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
                shadow.http_cors = options;
            });
        }
    };
}

// - handlers

/**
 * @method_decorator
 */
export function Handler(httpMethod: string = "GET", path: string = "") {
    return function (service: ServicePrototype, propertyKey: string, descriptor: PropertyDescriptor) {
        Shadow.addField(service, propertyKey, { http_method: httpMethod, http_path: path, method: true });
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
    Shadow.addParam(target, propertyKey, parameterIndex, { http_param_type: "body" });
}

/**
 * @param_decorator
 */
export function Search<S extends URLSearchParams>(
    target: ServicePrototype,
    propertyKey: string | symbol,
    parameterIndex: number
) {
    Shadow.addParam(target, propertyKey, parameterIndex, { http_param_type: "search_params" });
}

/**
 * @param_decorator
 */
export function Request<R>(target: ServicePrototype, propertyKey: string | symbol, parameterIndex: number) {
    Shadow.addParam(target, propertyKey, parameterIndex, { http_param_type: "req" });
}

/**
 * @param_decorator
 */
export function Headers<H extends Headers>(
    target: ServicePrototype,
    propertyKey: string | symbol,
    parameterIndex: number
) {
    Shadow.addParam(target, propertyKey, parameterIndex, { http_param_type: "headers" });
}

// -- Parsers

/**
 * Parses the request initially
 * @method_decorator
 */
export function Receive<R extends HTTPRequestParser>(
    target: ServicePrototype,
    propertyKey: string,
    descriptor: PropertyDescriptor
) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
}

/**
 * Parses the request before handling it
 * @method_decorator
 */
export function Middleware<R extends HTTPRequestParser>(
    target: ServicePrototype,
    propertyKey: string,
    descriptor: PropertyDescriptor
) {
    return Receive(target, propertyKey, descriptor);
}

/**
 * **Be careful! The decorated method will be modified and will return `Promise<HTTPNormalizedRequest>`.**
 * @method_decorator
 */
export function BodyParser<H extends Headers>(
    target: ServicePrototype,
    propertyKey: string,
    descriptor: PropertyDescriptor
) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
    const originalMethod = descriptor.value;
    descriptor.value = async function (request: HTTPNormalizedRequest) {
        const body = await originalMethod.apply(this, [request]);
        if (body === undefined) return request;
        return { ...request, body };
    };
}

/**
 * **Be careful! the decorated method will be modified and will return `Promise<HTTPNormalizedRequest>`.**
 * @method_decorator
 */
export function CookieParser<H extends Record<string, string>>(
    target: ServicePrototype,
    propertyKey: string,
    descriptor: PropertyDescriptor
) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
    const originalMethod = descriptor.value;
    descriptor.value = async function (request: HTTPNormalizedRequest) {
        const cookies = await originalMethod.apply(this, [request]);
        return { ...request, cookies: cookies };
    };
}

/**
 * **Be careful! The decorated method will be modified and will return `Promise<HTTPNormalizedRequest>`.**
 * @method_decorator
 */
export function SearchParser<H extends URLSearchParams>(
    target: ServicePrototype,
    propertyKey: string,
    descriptor: PropertyDescriptor
) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
    const originalMethod = descriptor.value;
    descriptor.value = async function (request: HTTPNormalizedRequest) {
        const search = await originalMethod.apply(this, [request]);
        return { ...request, search };
    };
}

/**
 * **Be careful! The decorated method will be modified and will return `Promise<HTTPNormalizedRequest>`.**
 * @method_decorator
 */
export function HeadersParser<H extends Headers>(
    target: ServicePrototype,
    propertyKey: string,
    descriptor: PropertyDescriptor
) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
    const originalMethod = descriptor.value;
    descriptor.value = async function (request: HTTPNormalizedRequest) {
        const headers = await originalMethod.apply(this, [request]);
        return { ...request, headers };
    };
}

/**
 * **Be careful! The decorated method will be modified and will return `Promise<HTTPNormalizedRequest>`.**
 * @method_decorator
 */
export function ContextProvider<C extends HTTPRequestContext>(
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

/**
 * The decorated method should throw an Error on failure.
 *
 * **Be careful, the decorated method will be modified and will return `HTTPNormalizedRequest`**
 * @method_decorator
 */
export function Authenticate<S extends HTTPSession>(
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

/**
 * Refines a response before sending it
 * @method_decorator
 */
export function Refine<R extends HTTPResponseRefiner>(
    target: ServicePrototype,
    propertyKey: string,
    descriptor: PropertyDescriptor
) {
    Shadow.addMethod(target, HTTP_FIELD.RESPONSE_REFINER, propertyKey);
}

// -- Send

/**
 * Refines a response before sending it
 * @method_decorator
 */
export function Send<R extends HTTPSender>(
    target: ServicePrototype,
    propertyKey: string,
    descriptor: PropertyDescriptor
) {
    Shadow.addMethod(target, HTTP_FIELD.SENDER, propertyKey);
}
