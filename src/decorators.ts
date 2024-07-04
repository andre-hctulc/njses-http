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
} from "./types";

/*
Extend NJSES `ServiceShadow` with Lambda specific fields 
*/
declare module "../../njses" {
    interface CustomShadow {
        http_cors: HTTPCORSOptions;
    }

    interface CustomShadowProp {
        http_method: string;
        http_path: string;
    }

    interface CustomShadowParam {
        http_param_type: "body" | "req" | "search_params" | "headers" | "context" | "session" | "cookie";
    }
}

/**
 * Assigns the HTTP role to a service
 * @class_decorator
 */
export function HTTP(service: ServiceCtr) {
    return Role(HTTP_ROLE.SERVICE)(service);
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

/*
Parameter decorators are called at runtime
*/

/**
 * @param_decorator
 */
export function Body<B>(target: ServicePrototype, propertyKey: string | symbol, parameterIndex: number) {
    Shadow.addParam(target, propertyKey, parameterIndex, { http_param_type: "body" });
}

/**
 * @param_decorator
 */
export function SearchParams<S extends URLSearchParams>(
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

/**
 * @method_decorator
 */
export function BodyParser<H extends Headers>(
    target: ServicePrototype,
    propertyKey: string,
    descriptor: PropertyDescriptor
) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
    const originalMethod = descriptor.value;
    descriptor.value = function (request: HTTPNormalizedRequest) {
        const body = originalMethod.apply(this, [request]);
        if (body === undefined) return request;
        return { ...request, body };
    };
}

/**
 * @method_decorator
 */
export function CookieParser<H extends Record<string, string>>(
    target: ServicePrototype,
    propertyKey: string,
    descriptor: PropertyDescriptor
) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
    const originalMethod = descriptor.value;
    descriptor.value = function (request: HTTPNormalizedRequest) {
        const cookies = originalMethod.apply(this, [request]);
        if (cookies === undefined) return request;
        return { ...request, cookies: cookies };
    };
}

/**
 * @method_decorator
 */
export function SearchParser<H extends URLSearchParams>(
    target: ServicePrototype,
    propertyKey: string,
    descriptor: PropertyDescriptor
) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
    const originalMethod = descriptor.value;
    descriptor.value = function (request: HTTPNormalizedRequest) {
        const search = originalMethod.apply(this, [request]);
        if (search === undefined) return request;
        return { ...request, search };
    };
}

/**
 * @method_decorator
 */
export function HeadersParser<H extends Headers>(
    target: ServicePrototype,
    propertyKey: string,
    descriptor: PropertyDescriptor
) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
    const originalMethod = descriptor.value;
    descriptor.value = function (request: HTTPNormalizedRequest) {
        const headers = originalMethod.apply(this, [request]);
        if (headers === undefined) return request;
        return { ...request, headers };
    };
}

/**
 * @method_decorator
 */
export function ContextProvider<C extends HTTPRequestContext>(
    target: ServicePrototype,
    propertyKey: string,
    descriptor: PropertyDescriptor
) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
    const originalMethod = descriptor.value;
    descriptor.value = function (request: HTTPNormalizedRequest) {
        const context = originalMethod.apply(this, [request]);
        if (context === undefined) return request;
        return { ...request, context };
    };
}

/**
 * @method_decorator
 */
export function Authenticate<S extends HTTPSession>(
    target: ServicePrototype,
    propertyKey: string,
    descriptor: PropertyDescriptor
) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
    const originalMethod = descriptor.value;
    descriptor.value = function (request: HTTPNormalizedRequest) {
        const session = originalMethod.apply(this, [request]);
        if (session === undefined) return request;
        return { ...request, session };
    };
}

/**
 * Parses the request initially
 * @method_decorator
 */
export function Reveive<R extends HTTPRequestParser>(
    target: ServicePrototype,
    propertyKey: string,
    descriptor: PropertyDescriptor
) {
    Shadow.addMethod(target, HTTP_FIELD.REQUEST_PARSER, propertyKey);
    const originalMethod = descriptor.value;
    descriptor.value = function (request: HTTPNormalizedRequest) {
        const req = originalMethod.apply(this, [request]);
        return req || request;
    };
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
    return Reveive(target, propertyKey, descriptor);
}

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
