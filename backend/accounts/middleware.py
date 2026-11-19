import time

from django.conf import settings


class SlidingSessionMiddleware:
    """People who keep using the app stay signed in.

    The session lifetime restarts at most once a day (not on every request: the call screens poll the server every
    few seconds and would otherwise write to the database each time). Someone who is away longer than
    SESSION_COOKIE_AGE is signed out as before.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        session = getattr(request, "session", None)
        user = getattr(request, "user", None)
        if session is not None and user is not None and user.is_authenticated:
            now = int(time.time())
            if now - int(session.get("_renewed", 0)) >= settings.SESSION_REFRESH_SECONDS:
                session["_renewed"] = now  # marks the session changed, so Django re-issues the cookie with a fresh expiry
        return self.get_response(request)
