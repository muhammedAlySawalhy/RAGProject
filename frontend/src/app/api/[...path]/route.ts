import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

async function proxyRequest(
  request: NextRequest,
  method: string,
): Promise<NextResponse> {
  const path = request.nextUrl.pathname;
  const searchParams = request.nextUrl.search;
  const targetUrl = `${BACKEND_URL}${path}${searchParams}`;

  try {
    const headers: HeadersInit = {};

    // Forward relevant headers
    const authHeader = request.headers.get("authorization");
    if (authHeader) {
      headers["Authorization"] = authHeader;
    }

    const contentType = request.headers.get("content-type");
    if (contentType) {
      headers["Content-Type"] = contentType;
    }

    const xContentRange = request.headers.get("x-content-range");
    if (xContentRange) {
      headers["X-Content-Range"] = xContentRange;
    }

    const contentRange = request.headers.get("content-range");
    if (contentRange) {
      headers["Content-Range"] = contentRange;
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    // Handle body for POST, PUT, PATCH, DELETE
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const contentType = request.headers.get("content-type") || "";

      if (contentType.includes("multipart/form-data")) {
        // For file uploads, pass the form data directly
        const formData = await request.formData();
        fetchOptions.body = formData;
        // Remove content-type header to let fetch set it with boundary
        delete (fetchOptions.headers as Record<string, string>)["Content-Type"];
      } else if (contentType.includes("application/json")) {
        const body = await request.json();
        fetchOptions.body = JSON.stringify(body);
      } else {
        // Try to get text body
        try {
          const text = await request.text();
          if (text) {
            fetchOptions.body = text;
          }
        } catch {
          // No body
        }
      }
    }

    const response = await fetch(targetUrl, fetchOptions);

    // Get response body
    const responseContentType = response.headers.get("content-type") || "";
    let responseBody: string | Blob;

    if (responseContentType.includes("application/json")) {
      responseBody = await response.text();
    } else {
      responseBody = await response.blob();
    }

    // Create response with same status and headers
    const responseHeaders: HeadersInit = {};
    response.headers.forEach((value, key) => {
      // Skip some headers that shouldn't be forwarded
      if (
        !["transfer-encoding", "connection", "keep-alive"].includes(
          key.toLowerCase(),
        )
      ) {
        responseHeaders[key] = value;
      }
    });

    return new NextResponse(responseBody, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(`Failed to proxy ${method} ${targetUrl}:`, error);

    return NextResponse.json(
      {
        error: "Failed to connect to backend",
        detail:
          error instanceof Error ? error.message : "Unknown error occurred",
      },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest) {
  return proxyRequest(request, "GET");
}

export async function POST(request: NextRequest) {
  return proxyRequest(request, "POST");
}

export async function PUT(request: NextRequest) {
  return proxyRequest(request, "PUT");
}

export async function PATCH(request: NextRequest) {
  return proxyRequest(request, "PATCH");
}

export async function DELETE(request: NextRequest) {
  return proxyRequest(request, "DELETE");
}
