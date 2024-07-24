import type { HTTPNormalizedResponse } from "./types";

export class HTTPError extends Error {
    constructor(
        readonly response: HTTPNormalizedResponse,
        readonly cause: unknown = undefined,
        readonly label: any = undefined
    ) {
        super(response.body);
    }
}

export class HTTPUnauthorizedError extends HTTPError {
    constructor(responseMessage?: string, cause?: unknown) {
        super(
            {
                status: 401,
                body: responseMessage ?? "Unauthorized",
            },
            cause,
            "Unauthorized"
        );
    }
}

export class HTTPForbiddenError extends HTTPError {
    constructor(responseMessage?: string, cause?: unknown) {
        super(
            {
                status: 403,
                body: responseMessage ?? "Forbidden",
            },
            cause,
            "Forbidden"
        );
    }
}

export class HTTPNotFoundError extends HTTPError {
    constructor(responseMessage?: string, cause?: unknown) {
        super(
            {
                status: 404,
                body: responseMessage ?? "Not Found",
            },
            cause,
            "Not Found"
        );
    }
}

export class HTTPBadRequestError extends HTTPError {
    constructor(responseMessage?: string, cause?: unknown) {
        super(
            {
                status: 400,
                body: responseMessage ?? "Bad Request",
            },
            cause,
            "Bad Request"
        );
    }
}

export class HTTPConflictError extends HTTPError {
    constructor(responseMessage?: string, cause?: unknown) {
        super(
            {
                status: 409,
                body: responseMessage ?? "Conflict",
            },
            cause,
            "Conflict"
        );
    }
}

export class HTTPInternalServerError extends HTTPError {
    constructor(responseMessage?: string, cause?: unknown) {
        super(
            {
                status: 500,
                body: responseMessage ?? "Internal Server Error",
            },
            cause,
            "Internal Server Error"
        );
    }
}
