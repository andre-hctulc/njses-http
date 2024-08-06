import { App, FieldShadow, Instance, Module, ParamShadow, Shadow } from "../../njses";
import { HTTP_FIELD, HTTP_ROLE } from "./const";
import type { Handler, Parser, Refine, Send } from "./decorators";
import { HTTPError } from "./errors";
import type {
    HTTPRequest,
    HTTPResponse,
    HTTPNormalizedRequest,
    HTTPCORSOptions,
    HTTPMatcherCheck,
    HTTPNormalizedResponse,
} from "./types";
import micromatch from "micromatch";

type AssigneeCacheEntry = {
    service: Instance;
    matcher: HTTPMatcherCheck | null;
    priotity?: number;
};

@Module({ name: "$$http_module" })
export class HTTPModule {
    private _sender: { service: Instance; method: string } | undefined;

    private _getSender(): { service: Instance; method: string } | null {
        if (this._sender) return this._sender;
        for (const service of App.getAssignees(HTTP_ROLE.SERVICE)) {
            const m = Shadow.require(service).getMethod(HTTP_FIELD.SENDER);
            if (m) return (this._sender = { service, method: m });
        }
        return null;
    }

    getAssignees(path: string): AssigneeCacheEntry[] {
        return App.getAssignees(HTTP_ROLE.SERVICE)
            .map((service) => {
                const shadow = Shadow.require(service);
                if (!shadow) throw new Error("Service shadow not found");
                return {
                    service,
                    matcher: shadow.getCtx("$http_matcher") || null,
                    priotity: shadow.getCtx("$http_options")?.priority,
                };
            })
            .sort((a, b) => {
                if (a.matcher === null && b.matcher !== null) return -1;
                if (a.matcher !== null && b.matcher === null) return 1;
                if (a.priotity === b.priotity) return 0;
                return a.priotity! > b.priotity! ? -1 : 1;
            });
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
    async incoming(handlerService: Instance, request: HTTPRequest): Promise<HTTPResponse> {
        try {
            return await this._incoming(handlerService, request);
        } catch (err) {
            if (err instanceof HTTPError) return this.send(this._emptyRequest(request), err.response);
            else throw err;
        }
    }

    private async _incoming(handlerService: Instance, request: HTTPRequest): Promise<HTTPResponse> {
        const handlerShadow = Shadow.require(handlerService);

        // -- parse request and get sender

        // inital request
        let normalizedRequest: HTTPNormalizedRequest = this._emptyRequest(request);
        // The path should get set eventually by a http service that has no matcher
        let path: string | undefined;
        const usedAssignees: AssigneeCacheEntry[] = [];

        for (const assignee of App.getAssignees(HTTP_ROLE.SERVICE)) {
            // continue if path does not match and not initialized
            if (path != null && !this.matches(path, assignee.matcher)) continue;

            const assigneeShadow = Shadow.require(assignee.service);
            usedAssignees.push(assignee);

            const methods = [
                // receive before parser
                ...assigneeShadow.getMethods(HTTP_FIELD.REQUEST_RECEIVE),
                ...assigneeShadow.getMethods(HTTP_FIELD.REQUEST_PARSER),
            ];

            for (const method of methods) {
                const p = assigneeShadow.getField(method);

                // continue if path does not match
                if (path != null && !this.matches(normalizedRequest.path, p?.$http_matcher)) continue;

                const newReq = App.invoke<Parser>(assignee.service, method, normalizedRequest);
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

        for (const prop of handlerShadow.getFields()) {
            if (
                prop.$http_method === normalizedRequest.method &&
                prop.$http_path === normalizedRequest.path
            ) {
                handlerProp = prop;
                break;
            }
        }

        if (!handlerProp)
            throw new Error(
                `No handler found for request "${normalizedRequest.method} ${normalizedRequest.path}"`
            );

        let normalizedResponse = await App.invoke<Handler>(
            handlerService,
            handlerProp.field as string,
            // Set injecte arguments, such as @Body, @Search, @Headers, @Context, @Session
            handlerShadow.mapArgs(
                handlerProp.field,
                [normalizedRequest],
                (arg, param) => this._getParam(normalizedRequest, param?.$http_param_type) || arg
            )[0]
        );

        // -- refine response

        for (const httpService of usedAssignees) {
            for (const ref of handlerShadow.getMethods(HTTP_FIELD.RESPONSE_REFINER)) {
                const p = handlerShadow.getField(ref);
                if (!this.matches(normalizedRequest.path, p?.$http_matcher)) continue;

                normalizedResponse = await App.invoke<Refine>(
                    httpService.service,
                    ref,
                    normalizedRequest,
                    normalizedResponse
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
        return await App.invoke<Send>(this._sender.service, this._sender.method, request, response);
    }

    private _getParam(request: HTTPNormalizedRequest, type: ParamShadow["$http_param_type"]) {
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
            const shadow = Shadow.require(httpService.service);
            const corsOptions = shadow.getCtx("$http_cors");

            if (corsOptions) cors = mergeCors(cors || {}, corsOptions);

            for (const corsField of shadow.getProps(HTTP_FIELD.CORS)) {
                const field = shadow.getField(corsField);

                // apply matcher
                if (!this.matches(request.path, field?.$http_matcher)) continue;

                cors = mergeCors(
                    cors || {},
                    (await App.resolve<HTTPCORSOptions>(httpService.service, corsField, request)) || {}
                );
            }
        }

        return cors;
    }
}
