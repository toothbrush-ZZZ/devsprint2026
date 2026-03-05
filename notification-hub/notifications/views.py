from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from .permissions import IsAdminUser
import redis
import os

# Get the channel layer — this is how we send
# messages to WebSocket connections from regular views
channel_layer = get_channel_layer()

redis_client = redis.from_url(os.getenv('REDIS_URL', 'redis://redis:6379'))

# Metrics
total_notifications = 0
failed_notifications = 0

STATUS_MESSAGES = {
    'pending':        'Your order has been received',
    'stock_verified': 'Stock confirmed! Your order is being processed',
    'in_kitchen':     'Your food is being prepared by kitchen staff',
    'ready':          'Your food is ready! Please collect it',
    'cancelled':      'Your order has been cancelled',
    'failed':         'Your order could not be processed. Please try again',
}

KITCHEN_MESSAGES = {
    'new_order':   'New order received!',
    'cancelled':   'Order has been cancelled — stop preparing',
}


# ─────────────────────────────────────────
# NOTIFY — called by Order Gateway
# ─────────────────────────────────────────
@api_view(['POST'])
@permission_classes([AllowAny])
def notify(request):
    """
    POST /notify/
    Called by Order Gateway when order status changes.
    Pushes update to student's WebSocket connection.
    Also notifies kitchen staff for relevant events.

    Body: {
        "order_id": 1,
        "student_id": "210041001",
        "status": "in_kitchen"
    }
    """
    global total_notifications, failed_notifications

    order_id = request.data.get('order_id')
    student_id = request.data.get('student_id')
    order_status = request.data.get('status')
    item_name = request.data.get('item_name', '')
    quantity = request.data.get('quantity', 1)

    if not order_id or not student_id or not order_status:
        return Response(
            {"error": "order_id, student_id and status are required"},
            status=status.HTTP_400_BAD_REQUEST
        )

    message = STATUS_MESSAGES.get(order_status, f"Order status: {order_status}")

    # ─────────────────────────────────
    # PUSH TO STUDENT WebSocket
    # ─────────────────────────────────
    try:
        async_to_sync(channel_layer.group_send)(
            f"student_{student_id}",  # the student's group name
            {
                "type": "order_update",   # matches method name in consumer
                "order_id": order_id,
                "status": order_status,
                "message": message
            }
        )
        total_notifications += 1
        print(f"Notified student {student_id}: order {order_id} is {order_status}")

    except Exception as e:
        failed_notifications += 1
        print(f"Failed to notify student {student_id}: {e}")

    # ─────────────────────────────────
    # PUSH TO KITCHEN STAFF WebSocket
    # Only for relevant kitchen events
    # ─────────────────────────────────
    kitchen_events = {
        'in_kitchen': 'new_order',
        'cancelled':  'cancelled',
    }

    if order_status in kitchen_events:
        try:
            event_type = kitchen_events[order_status]
            kitchen_message = KITCHEN_MESSAGES.get(event_type, '')

            async_to_sync(channel_layer.group_send)(
                "kitchen_staff",  
                {
                    "type": "kitchen_update",  # matches method in consumer
                    "order_id": order_id,
                    "event_type": event_type,
                    "item_name": item_name,
                    "quantity": quantity,
                    "student_id": student_id,
                    "message": kitchen_message
                }
            )
            print(f"Notified kitchen staff: order {order_id} {event_type}")

        except Exception as e:
            print(f"Failed to notify kitchen staff: {e}")

    return Response({
        "success": True,
        "order_id": order_id,
        "student_id": student_id,
        "status": order_status,
        "message": message
    })


# ─────────────────────────────────────────
# HEALTH CHECK
# public
# ─────────────────────────────────────────
@api_view(['GET'])
@permission_classes([AllowAny])
def health(request):
    """
    GET /health/
    Checks Redis and channel layer are working.
    Returns 200 if all good, 503 if anything is down.
    """
    try:
        if redis_client.get('chaos_mode:notification') == b'1':
            return Response({"error": "Service in chaos mode"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    except Exception:
        pass
    redis_status = "ok"
    channel_status = "ok"

    try:
        redis_client.ping()
    except Exception as e:
        redis_status = f"error: {str(e)}"

    try:
        async_to_sync(channel_layer.group_send)(
            "health_check",
            {"type": "health.check"}
        )
    except Exception as e:
        channel_status = f"error: {str(e)}"

    if redis_status != "ok" or channel_status != "ok":
        return Response(
            {
                "status": "error",
                "redis": redis_status,
                "channel_layer": channel_status
            },
            status=status.HTTP_503_SERVICE_UNAVAILABLE
        )

    return Response({
        "status": "ok",
        "redis": redis_status,
        "channel_layer": channel_status
    })


# ─────────────────────────────────────────
# METRICS
# public
# ─────────────────────────────────────────
@api_view(['GET'])
@permission_classes([AllowAny])
def metrics(request):
    """
    GET /metrics/
    Returns notification stats for admin dashboard.
    """
    return Response({
        "service": "notification-hub",
        "total_notifications_sent": total_notifications,
        "failed_notifications": failed_notifications,
        "status": "running"
    })

# ─────────────────────────────────────────
# CHAOS TOGGLE
# admins only
# ─────────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsAdminUser])
def toggle_chaos(request):
    """
    POST /chaos/
    Manual trigger to kill the service for fault tolerance testing.
    """
    try:
        current = redis_client.get('chaos_mode:notification')
        if current and current == b'1':
            redis_client.delete('chaos_mode:notification')
            return Response({"status": "Chaos mode disabled"})
        else:
            redis_client.set('chaos_mode:notification', '1', ex=600) # 600 seconds (10 min)
            return Response({"status": "Chaos mode enabled for 10 minutes"})
    except Exception as e:
        return Response({"error": f"Failed to toggle chaos: {e}"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)