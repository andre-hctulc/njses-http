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
