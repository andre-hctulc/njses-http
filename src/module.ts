import { Module, ServiceCtr, ServiceRegistery } from "../../njses";
import { Shadow, ParamShadow, FieldShadow } from "../../njses/shadow";
import { HTTP_FIELD, HTTP_ROLE } from "./const";
import { HTTPError } from "./error";
import type {
    HTTPHandler,
    HTTPRequest,
    HTTPRequestParser,
    HTTPResponse,
    HTTPResponseRefiner,
    HTTPSender,
    HTTPNormalizedRequest,
    HTTPCORSOptions,
} from "./types";

@Module({ name: "$$http_module" })
export class HTTPModule {
    async incoming(handlerService: ServiceCtr, request: HTTPRequest): Promise<HTTPResponse> {
        try {
            return await this._incoming(handlerService, request);
        } catch (err) {
            if (err instanceof HTTPError) return err.response;
            else throw err;
        }
    }

    private async _incoming(handlerService: ServiceCtr, request: HTTPRequest): Promise<HTTPResponse> {
        // -- get required service instances

        const handlerServiceInstance = ServiceRegistery.getInstanceByCtr(handlerService);
        if (!handlerServiceInstance) throw new Error("Request handler service not found");

        const httpServiceInstances = ServiceRegistery.getAssignees(HTTP_ROLE.SERVICE).map((s) =>
            ServiceRegistery.getInstanceByCtr(s)
        );

        if (!httpServiceInstances.length) throw new Error("No HTTP service found");

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

        let sender: { service: ServiceCtr; method: string } | undefined;

        for (const service of httpServiceInstances) {
            const parserField = Shadow.getMethod(service, HTTP_FIELD.REQUEST_PARSER);

            if (!sender) {
                const senderMethodName = Shadow.getMethod(service, HTTP_FIELD.SENDER);
                if (senderMethodName) sender = { service, method: senderMethodName };
            }

            if (parserField) {
                const newReq = ServiceRegistery.invoke<HTTPRequestParser>(service, parserField, [
                    normalizedRequest,
                ]);
                if (newReq) normalizedRequest = newReq;
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
            handlerServiceInstance,
            handlerProp.field as string,
            // Set injecte arguments, such as @Body, @Search, @Headers, @Context, @Session
            Shadow.mapArgs(
                handlerServiceInstance,
                handlerProp.field,
                [normalizedRequest],
                (arg, param) => this._getParam(normalizedRequest, param?.http_param_type) || arg
            )
        );

        // -- refine response

        for (const httpService of httpServiceInstances) {
            for (const ref of Shadow.getMethods(httpService, HTTP_FIELD.RESPONSE_REFINER)) {
                normalizedResponse = await ServiceRegistery.invoke<HTTPResponseRefiner>(httpService, ref, [
                    normalizedRequest,
                    normalizedResponse,
                ]);
            }
        }

        // -- Set CORS headers

        const corsOptions = await this._collectCorsOptions(httpServiceInstances, normalizedRequest);

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
        services: any[],
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

        for (const service of services) {
            const shadow = Shadow.get(service, true);
            if (shadow.http_cors) cors = mergeCors(cors || {}, shadow.http_cors);
            for (const f of Shadow.getProps(service, HTTP_FIELD.CORS)) {
                cors = mergeCors(
                    cors || {},
                    (await ServiceRegistery.resolve<HTTPCORSOptions>(service, f, [request])) || {}
                );
            }
        }

        return cors;
    }
}
