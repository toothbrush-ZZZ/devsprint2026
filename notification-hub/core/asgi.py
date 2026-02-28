import os
import django
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
django.setup()

from notifications.routing import websocket_urlpatterns

# ProtocolTypeRouter handles two types of connections:
# 1. http — regular HTTP requests (Django handles these)
# 2. websocket — persistent connections (Channels handles these)
application = ProtocolTypeRouter({
    'http': get_asgi_application(),
    'websocket': URLRouter(websocket_urlpatterns)
})