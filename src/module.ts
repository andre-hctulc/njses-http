import { Init, Module, ServiceCtr, ServiceInstance, ServiceRegistery } from "../../njses";
import { Shadow, ParamShadow, FieldShadow } from "../../njses/shadow";
import { HTTP_FIELD, HTTP_ROLE } from "./const";
import { HTTPError } from "./errors";
import type {
    HTTPHandler,
    HTTPRequest,
    HTTPRequestParser,
    HTTPResponse,
    HTTPResponseRefiner,
    HTTPSender,
    HTTPNormalizedRequest,
    HTTPCORSOptions,
    HTTPMatcher,
} from "./types";
import micromatch from "micromatch";

type AssigneeCacheEntry = {
    service: ServiceInstance;
    matcher: HTTPMatcher | null;
    priotity?: number;
};

@Module({ name: "$$http_module" })
export class HTTPModule {
    private _httpServices: AssigneeCacheEntry[] = [];

    @Init
    private async _collectHttpServices() {
        // Sort, so that services without matcher are at the beginning
        this._httpServices = ServiceRegistery.getAssignees(HTTP_ROLE.SERVICE)
            .map((service) => {
                const shadow = Shadow.get(service, true);
                if (!service) throw new Error("Service not found");
                if (!shadow) throw new Error("Service shadow not found");
                return {
                    service,
                    matcher: shadow.http_options?.match || null,
                    priotity: shadow.http_options?.priority,
                };
            })
            .sort((a, b) => {
                if (a.matcher === null && b.matcher !== null) return -1;
                if (a.matcher !== null && b.matcher === null) return 1;
                if (a.priotity === b.priotity) return 0;
                return a.priotity! > b.priotity! ? -1 : 1;
            });
    }

    getAssignees(path: string): AssigneeCacheEntry[] {
        return this._httpServices.filter((a) => !a.matcher || this.matches(path, a.matcher));
    }

    matches(path: string, matcher: HTTPMatcher | null | undefined): boolean {
        if (matcher == null) return true;
        if (Array.isArray(matcher)) return matcher.some((m) => this.matches(path, m));
        if (typeof matcher === "string") return micromatch.isMatch(path, matcher);
        else return matcher.test(path);
    }

    async incoming(handlerService: ServiceInstance, request: HTTPRequest): Promise<HTTPResponse> {
        try {
            return await this._incoming(handlerService, request);
        } catch (err) {
            if (err instanceof HTTPError) return err.response;
            else throw err;
        }
    }

    private async _incoming(handlerService: ServiceInstance, request: HTTPRequest): Promise<HTTPResponse> {
        // -- parse request and get sender

        // inital request
        let normalizedRequest: HTTPNormalizedRequest = {
            originalRequest: request,
            body: undefined,
            searchParams: new URLSearchParams(),
            headers: new Headers(),
            cookies: {},
            method: "GET",
            path: "",
        };
        // The path should get set eventually by a http service that has no matcher
        let path: string | undefined;
        let sender: { service: ServiceCtr; method: string } | undefined;
        const usedAssignees: AssigneeCacheEntry[] = [];

        for (const assignee of this._httpServices) {
            // continue if path does not match
            if (path !== undefined && !this.matches(path, assignee.matcher)) continue;

            usedAssignees.push(assignee);

            // find sender once
            if (!sender) {
                const senderMethodName = Shadow.getMethod(assignee.service, HTTP_FIELD.SENDER);
                if (senderMethodName) sender = { service: assignee.service, method: senderMethodName };
            }

            for (const method of Shadow.getMethods(assignee.service, HTTP_FIELD.REQUEST_PARSER)) {
                const newReq = ServiceRegistery.invoke<HTTPRequestParser>(assignee.service, method, [
                    normalizedRequest,
                ]);
                if (newReq) {
                    // set path, when first set
                    // BUG this could include services where the matcher does not match. For now ew can use priotity to sort them
                    if (newReq.path !== undefined) path = newReq.path;
                    normalizedRequest = { ...normalizedRequest, ...newReq };
                }
            }
        }

        if (!sender) throw new Error("No sender found");

        // -- get inital response

        let handlerProp: FieldShadow | undefined;

        for (const prop of Shadow.getFields(handlerService)) {
            if (prop.http_method === normalizedRequest.method && prop.http_path === normalizedRequest.path) {
                handlerProp = prop;
                break;
            }
        }

        if (!handlerProp)
            throw new Error(
                `No handler found for request "${normalizedRequest.method} ${normalizedRequest.path}"`
            );

        let normalizedResponse = await ServiceRegistery.invoke<HTTPHandler>(
            handlerService,
            handlerProp.field as string,
            // Set injecte arguments, such as @Body, @Search, @Headers, @Context, @Session
            Shadow.mapArgs(
                handlerService,
                handlerProp.field,
                [normalizedRequest],
                (arg, param) => this._getParam(normalizedRequest, param?.http_param_type) || arg
            )
        );

        // -- refine response

        for (const httpService of usedAssignees) {
            for (const ref of Shadow.getMethods(httpService.service, HTTP_FIELD.RESPONSE_REFINER)) {
                normalizedResponse = await ServiceRegistery.invoke<HTTPResponseRefiner>(
                    httpService.service,
                    ref,
                    [normalizedRequest, normalizedResponse]
                );
            }
        }

        // -- Set CORS headers

        const corsOptions = await this._collectCorsOptions(usedAssignees, normalizedRequest);

        if (corsOptions) {
            const headers = normalizedRequest.headers;
            const origin = headers.get("Origin");

            // We only set the headers if the origin is given
            if (origin) {
                headers.set("Access-Control-Allow-Origin", origin);
                headers.set("Access-Control-Allow-Headers", corsOptions.allowHeaders?.join(",") ?? "");
                headers.set("Access-Control-Allow-Methods", normalizedRequest.method);
                headers.set("Access-Control-Expose-Headers", corsOptions.exposeHeaders?.join(",") ?? "");
                headers.set("Access-Control-Max-Age", (corsOptions.maxAge || 600).toString());
                headers.set(
                    "Access-Control-Allow-Credentials",
                    corsOptions.allowCredentials ? "true" : "false"
                );
            }
        }

        // -- create sendable response

        const response = await ServiceRegistery.invoke<HTTPSender>(sender.service, sender.method, [
            normalizedRequest,
            normalizedResponse,
        ]);

        return response;
    }

    private _getParam(request: HTTPNormalizedRequest, type: ParamShadow["http_param_type"]) {
        switch (type) {
            case "body":
                return request.body;
            case "req":
                return request.originalRequest;
            case "search_params":
                return request.searchParams;
            case "headers":
                return request.headers;
            case "context":
                return request.context;
            case "session":
                return request.session;
            case "cookie":
                return request.cookies;
        }
    }

    private async _collectCorsOptions(
        httpServices: AssigneeCacheEntry[],
        request: HTTPNormalizedRequest
    ): Promise<HTTPCORSOptions | undefined> {
        let cors: HTTPCORSOptions | undefined;

        const mergeCors = (o1: HTTPCORSOptions, o2: HTTPCORSOptions) => {
            let result = o1;
            for (const key in o2) {
                if ((o2 as any)[key] !== undefined) (result as any)[key] = (o2 as any)[key];
            }
            return result;
        };

        for (const httpService of httpServices) {
            const shadow = Shadow.get(httpService.service, true);
            if (shadow.http_cors) cors = mergeCors(cors || {}, shadow.http_cors);
            for (const f of Shadow.getProps(httpService.service, HTTP_FIELD.CORS)) {
                cors = mergeCors(
                    cors || {},
                    (await ServiceRegistery.resolve<HTTPCORSOptions>(httpService.service, f, [request])) || {}
                );
            }
        }

        return cors;
    }
}
