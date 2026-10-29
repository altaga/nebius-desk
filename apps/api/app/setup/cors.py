"""Private Network Access header so Chrome can probe the local Docker/USB board."""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class PrivateNetworkMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)
        if request.url.path.startswith("/setup"):
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response
