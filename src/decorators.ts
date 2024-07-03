import { MapArgs, ServiceInstance, Shadow, use, useSync } from "../../njses";
import { Config } from "../../njses/services/config";
import type { CORSOptions } from "./types";

export enum HTTP_FIELD {
    METHOD = "$$http_method",
    CORS = "$$http_cors",
}
/*
Extend NJSES `ServiceShadow` with Lambda specific fields 
*/
declare module "../../njses" {
    interface CustomShadow {
        http_cors: CORSOptions;
    }

    interface CustomShadowProp {
        http_method: string;
        http_cors: CORSOptions;
    }

    interface CustomShadowParam {
        http_param_type: "body" | "req" | "search_params" | "headers";
    }
}

/**
 * @class_decorator
 * @method_decorator
 */
export function CORS(options: CORSOptions) {
    return function (target: any, propertyKey?: string | symbol, descriptor?: PropertyDescriptor) {
        // CORS Handler based
        if (propertyKey) {
            Shadow.addProp(target, propertyKey, { http_cors: options, method: true });
        }
        // CORS Class based
        else {
            Shadow.update(target, (shadow) => {
                shadow.http_cors = options;
            });
        }
    };
}

export const REQUEST_RESOLVER = "$$REQUEST_RESOLVER";
export type RequestResolver<R, O = {}> = (
    request: R,
    options: O | undefined
) => {
    body: any;
    searchParams: URLSearchParams;
    headers: Headers;
};

/**
 * @method_decorator
 * @template R Request
 * @template O Handler options
 */
export function Handler<R, O = {}>(httpMethod: string, options?: O) {
    return function (service: ServiceInstance, propertyKey: string, descriptor: PropertyDescriptor) {
        if (httpMethod) Shadow.addProp(service, propertyKey, { http_method: httpMethod, method: true });

        // Insert HANDLER params
        MapArgs((args, param) => {
            // The config should be mounted here, as method decorators are called at runtime
            const config = useSync(Config);

            // get resolver from config, if not found, return args as is
            const requestResolver = config.get<RequestResolver<R, O>>(REQUEST_RESOLVER);
            if (!requestResolver) return args;

            const { body, searchParams, headers } = requestResolver(args[0], options);

            return Shadow.mapArgs(service, propertyKey, args, (arg, param) => {
                switch (param?.http_param_type) {
                    case "body":
                        return body;
                    case "req":
                        return args[0];
                    case "search_params":
                        return searchParams;
                    case "headers":
                        return headers;
                }
                return arg;
            });
        })(service, propertyKey, descriptor);
    };
}

/**
 * @method_decorator
 */
export const POST =
    () =>
    <R, O = {}>(options?: O) =>
        Handler<R, O>("POST", options);

/**
 * @method_decorator
 */
export const PUT = <R, O = {}>(options?: O) => Handler<R, O>("PUT", options);

/**
 * @method_decorator
 */
export const GET = <R, O = {}>(options?: O) => Handler<R, O>("GET", options);

/**
 * @method_decorator
 */
export const DELETE = <R, O = {}>(options?: O) => Handler<R, O>("DELETE", options);

/*
Parameter decorators are called at runtime
*/

interface BodyOptions {
    /** @default true */
    parse?: boolean;
}

/**
 * @param_decorator
 */
export function Body<B = any>(options: BodyOptions = {}) {
    return function (target: any, propertyKey: string | symbol, parameterIndex: number) {
        Shadow.addParam(target, propertyKey, parameterIndex, {
            http_param_type: "body",
        });
    };
}

/**
 * @param_decorator
 */
export function SearchParams<S extends URLSearchParams>(
    target: any,
    propertyKey: string | symbol,
    parameterIndex: number
) {
    Shadow.addParam(target, propertyKey, parameterIndex, { http_param_type: "search_params" });
}

/**
 * @param_decorator
 */
export function Request<R>(target: any, propertyKey: string | symbol, parameterIndex: number) {
    Shadow.addParam(target, propertyKey, parameterIndex, { http_param_type: "req" });
}

/**
 * @param_decorator
 */
export function Headers<H extends Headers>(
    target: any,
    propertyKey: string | symbol,
    parameterIndex: number
) {
    Shadow.addParam(target, propertyKey, parameterIndex, { http_param_type: "headers" });
}
