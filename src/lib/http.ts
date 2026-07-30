import { NextResponse } from "next/server";
import { z } from "zod";
import { UnauthenticatedError } from "./session";

/**
 * Shared route helpers.
 *
 * One shape for every error the API returns, so a client never has to guess
 * which of three formats it got. Not an abstraction layer — there is no
 * indirection here, only two functions and a discriminated body.
 */

export interface ApiError {
  error: string;
  /** Machine-readable. The refusal reason for a business outcome. */
  code: string;
  detail?: string;
}

export function fail(
  status: number,
  code: string,
  error: string,
  detail?: string,
): NextResponse<ApiError> {
  return NextResponse.json(
    detail === undefined ? { error, code } : { error, code, detail },
    { status },
  );
}

/**
 * Parses a JSON body against a schema.
 *
 * Returns a response on failure rather than throwing, so routes stay linear.
 * A malformed body is a 400 and never reaches a service.
 */
export async function parseBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse<ApiError> }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: fail(400, "MALFORMED_JSON", "request body is not JSON") };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: fail(
        400,
        "INVALID_BODY",
        "request body failed validation",
        parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; "),
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Turns an UnauthenticatedError into a 401 and lets everything else through.
 *
 * Deliberately narrow: an unexpected error must reach the framework and be
 * logged as a 500, not be flattened into a tidy JSON body that hides a defect.
 */
export function unauthenticatedToResponse(error: unknown): NextResponse<ApiError> | null {
  if (error instanceof UnauthenticatedError) {
    return fail(401, "UNAUTHENTICATED", "sign in to continue");
  }
  return null;
}
