/* 
ev: APIGatewayProxyEvent, ctx: Context, rctx: ProtectedReqCtx 
*/
export interface CORSOptions {
    /** Allow origins */
    origins: string[] | "*";
    allowHeaders?: string[];
    exposeHeaders?: string[];
    maxAge?: number;
    allowCredentials?: boolean;
}
