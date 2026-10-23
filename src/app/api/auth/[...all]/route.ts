import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/config";

// Better Auth endpoints (sign-up, sign-in, sign-out, session) under /api/auth/*.
export const { GET, POST } = toNextJsHandler((request: Request) => getAuth().handler(request));
