import { TalentSignalHttpError } from "@talent-signal/contracts";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { workspaceSessionExpiryHeaders } from "@/lib/backend-session";
import {
  isIntegrationMode,
  loadPeopleDirectory,
} from "@/lib/server/localBackend";

export const dynamic = "force-dynamic";

function response(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      ...workspaceSessionExpiryHeaders(status, body),
    },
  });
}

export async function GET(request: NextRequest) {
  if (!isIntegrationMode()) {
    return response({ code: "local_integration_disabled" }, 404);
  }
  const session = await auth();
  if (!session?.user) {
    return response({ code: "AUTHENTICATION_REQUIRED" }, 401);
  }
  const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
  if (query.length > 160) {
    return response({ code: "people_query_invalid" }, 400);
  }
  try {
    return response(await loadPeopleDirectory(query));
  } catch (error) {
    if (error instanceof TalentSignalHttpError) {
      return response(
        { code: error.code, message: error.message },
        error.status,
      );
    }
    return response({ code: "people_directory_unavailable" }, 503);
  }
}
