import { Init, Module, ServiceInstance, ServiceRegistery } from "../../njses";
import { Shadow, ParamShadow, FieldShadow } from "../../njses/src/shadow";
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
    HTTPMatcherCheck,
    HTTPNormalizedResponse,
} from "./types";
import micromatch from "micromatch";

type AssigneeCacheEntry = {
    service: ServiceInstance;
    matcher: HTTPMatcherCheck | null;
    priotity?: number;
};

@Module({ name: "$$http_module" })
export class HTTPModule {
    private _httpServices: AssigneeCacheEntry[] = [];
    private _sender: { service: ServiceInstance; method: string } | undefined;

    @Init
    private async _collectHttpServices() {
        // Sort, so that services without matcher are at the beginning
        this._httpServices = ServiceRegistery.getAssignees(HTTP_ROLE.SERVICE)
            .map((service) => {
                const shadow = Shadow.get(service, true);
                if (!service) throw new Error("Service not found");
                if (!shadow) throw new Error("Service shadow not found");
                if (!this._sender) {
                    const senderMethod = Shadow.getMethod(service, HTTP_FIELD.SENDER);
                    if (senderMethod) {
                        this._sender = {
                            service,
                            method: senderMethod,
                        };
                    }
                }
                return {
                    service,
                    matcher: shadow.http_matcher || null,
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
        return this._httpServices.filter((a) => this.matches(path, a.matcher));
    }

    matches(path: string, matcher: HTTPMatcherCheck | null | undefined): boolean {
        if (matcher == null) return true;
        else if (Array.isArray(matcher)) return matcher.some((m) => this.matches(path, m));
        else if (typeof matcher === "string") return micromatch.isMatch(path, matcher);
        else if (typeof matcher === "function") return matcher(path);
        else return matcher.test(path);
    }

    private _emptyRequest(request: HTTPRequest): HTTPNormalizedRequest {
        return {
            originalRequest: request,
            body: undefined,
            searchParams: new URLSearchParams(),
            headers: new Headers(),
            cookies: {},
            method: "",
            path: "",
        };
    }

    /**
     * Creates a response and sends it
     */
    async incoming(handlerService: ServiceInstance, request: HTTPRequest): Promise<HTTPResponse> {
        try {
            return await this._incoming(handlerService, request);
        } catch (err) {
            if (err instanceof HTTPError) return this.send(this._emptyRequest(request), err.response);
            else throw err;
        }
    }

    private async _incoming(handlerService: ServiceInstance, request: HTTPRequest): Promise<HTTPResponse> {
        // -- parse request and get sender

        // inital request
        let normalizedRequest: HTTPNormalizedRequest = this._emptyRequest(request);
        // The path should get set eventually by a http service that has no matcher
        let path: string | undefined;
        const usedAssignees: AssigneeCacheEntry[] = [];

        for (const assignee of this._httpServices) {
            // continue if path does not match
            if (path != null && !this.matches(path, assignee.matcher)) continue;

            usedAssignees.push(assignee);

            for (const method of Shadow.getMethods(assignee.service, HTTP_FIELD.REQUEST_PARSER)) {
                const p = Shadow.getField(assignee, method);

                // continue if path does not match
                if (path != null && !this.matches(normalizedRequest.path, p?.http_matcher)) continue;

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
                const p = Shadow.getField(httpService, ref);
                if (!this.matches(normalizedRequest.path, p?.http_matcher)) continue;

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

        return await this.send(normalizedRequest, normalizedResponse);
    }

    async send(request: HTTPNormalizedRequest, response: HTTPNormalizedResponse) {
        if (!this._sender) throw new Error("No sender found");
        return await ServiceRegistery.invoke<HTTPSender>(this._sender.service, this._sender.method, [
            request,
            response,
        ]);
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

    /**
     * @param httpServices The services to collect the CORS options from. These should match the request path already!
     */
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

            for (const corsField of Shadow.getProps(httpService.service, HTTP_FIELD.CORS)) {
                const field = Shadow.getField(httpService, corsField);

                // apply matcher
                if (!this.matches(request.path, field?.http_matcher)) continue;

                cors = mergeCors(
                    cors || {},
                    (await ServiceRegistery.resolve<HTTPCORSOptions>(httpService.service, corsField, [
                        request,
                    ])) || {}
                );
            }
        }

        return cors;
    }
}
