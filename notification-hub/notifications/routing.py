from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    # Student connects to their own channel
    # e.g. ws://notification-hub:8005/ws/student/210041001/
    re_path(
        r'ws/student/(?P<student_id>\w+)/$',
        consumers.StudentNotificationConsumer.as_asgi()
    ),

    # Kitchen staff connect to shared channel
    # e.g. ws://notification-hub:8005/ws/kitchen/
    re_path(
        r'ws/kitchen/$',
        consumers.KitchenNotificationConsumer.as_asgi()
    ),
]