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
    constructor() {
        super(
            {
                status: 401,
                body: "Unauthorized",
            },
            undefined,
            "Unauthorized"
        );
    }
}

export class HTTPForbiddenError extends HTTPError {
    constructor() {
        super(
            {
                status: 403,
                body: "Forbidden",
            },
            undefined,
            "Forbidden"
        );
    }
}

export class HTTPNotFoundError extends HTTPError {
    constructor() {
        super(
            {
                status: 404,
                body: "Not Found",
            },
            undefined,
            "Not Found"
        );
    }
}

export class HTTPBadRequestError extends HTTPError {
    constructor() {
        super(
            {
                status: 400,
                body: "Bad Request",
            },
            undefined,
            "Bad Request"
        );
    }
}

export class HTTPConflictError extends HTTPError {
    constructor() {
        super(
            {
                status: 409,
                body: "Conflict",
            },
            undefined,
            "Conflict"
        );
    }
}

export class HTTPInternalServerError extends HTTPError {
    constructor() {
        super(
            {
                status: 500,
                body: "Internal Server Error",
            },
            undefined,
            "Internal Server Error"
        );
    }
}
