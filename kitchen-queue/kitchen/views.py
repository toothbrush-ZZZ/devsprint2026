from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status
from django.conf import settings
from .models import KitchenOrder
from .permissions import IsStudent, IsAdminUser
import requests
import redis
import threading
import time

redis_client = redis.from_url(settings.REDIS_URL)

# Metrics counters
total_processed = 0
failed_count = 0
response_times = []


def update_order_gateway_status(order_id, new_status, token=None):
   
    try:
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        requests.patch(
            f"{settings.ORDER_GATEWAY_URL}/order/{order_id}/status/",
            json={"status": new_status},
            headers=headers,
            timeout=5
        )
        print(f"Order {order_id} status updated to {new_status}")
    except Exception as e:
        print(f"Failed to update order gateway status: {e}")


def process_order_in_background(kitchen_order_id, order_id, token):
    """
    This function runs in a SEPARATE THREAD.
    """
    try:
        kitchen_order = KitchenOrder.objects.get(id=kitchen_order_id)

        kitchen_order.status = 'preparing'
        kitchen_order.save()

        update_order_gateway_status(order_id, 'in_kitchen', token)

        print(f"Order {order_id} is now in kitchen. Waiting for staff to mark ready.")

    except Exception as e:
        print(f"Background processing failed for order {order_id}: {e}")
        try:
            kitchen_order = KitchenOrder.objects.get(id=kitchen_order_id)
            kitchen_order.status = 'failed'
            kitchen_order.save()
            update_order_gateway_status(order_id, 'failed', token)
        except Exception:
            pass


# ─────────────────────────────────────────
# RECEIVE ORDER FROM ORDER GATEWAY
# authenticated — Order Gateway sends token
# ─────────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsStudent])
def receive_order(request):
    """
    POST /kitchen/orders/
    Called by Order Gateway when a student places an order.
    Immediately acknowledges the order (under 2 seconds).
    Starts background thread to update status to preparing.
    Kitchen staff then manually mark order ready when food is done.
    """
    global total_processed, failed_count, response_times
    start_time = time.time()

    order_id = request.data.get('order_id')
    student_id = request.data.get('student_id')
    item_id = request.data.get('item_id')
    item_name = request.data.get('item_name', '')
    quantity = request.data.get('quantity', 1)


    if not order_id or not student_id or not item_id:
        return Response(
            {"error": "order_id, student_id and item_id are required"},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Check if this order already exists in kitchen
    # Prevents duplicate kitchen orders
    existing = KitchenOrder.objects.filter(order_id=order_id).first()
    if existing:
        return Response({
            "success": True,
            "kitchen_order_id": existing.id,
            "order_id": order_id,
            "status": existing.status,
            "message": "Order already in kitchen",
            "duplicate": True
        })


    kitchen_order = KitchenOrder.objects.create(
        order_id=order_id,
        student_id=student_id,
        item_id=item_id,
        item_name=item_name,
        quantity=quantity,
        status='queued'
    )

    auth_header = request.headers.get('Authorization', '')
    token = auth_header.replace('Bearer ', '') if auth_header else ''

    # START BACKGROUND THREAD
    thread = threading.Thread(
        target=process_order_in_background,
        args=(kitchen_order.id, order_id, token),
        daemon=True
        # daemon=True means thread stops if main program stops
        # prevents zombie threads hanging around
    )
    thread.start()

    # Record response time
    elapsed = time.time() - start_time
    response_times.append(elapsed)
    if len(response_times) > 100:
        response_times.pop(0)

    total_processed += 1

    return Response({
        "success": True,
        "kitchen_order_id": kitchen_order.id,
        "order_id": order_id,
        "status": "queued",
        "message": "Order received by kitchen! Staff will prepare your food.",
        "response_time_seconds": round(elapsed, 3)
    }, status=status.HTTP_201_CREATED)


# ─────────────────────────────────────────
# GET ALL KITCHEN ORDERS
# admins only — kitchen staff view
# ─────────────────────────────────────────
@api_view(['GET'])
@permission_classes([IsAdminUser])
def get_kitchen_orders(request):
    """
    GET /kitchen/orders/all/
    Kitchen staff can see all orders and their status.
    """
    status_filter = request.query_params.get('status', None)

    if status_filter:
        orders = KitchenOrder.objects.filter(
            status=status_filter
        ).order_by('-created_at')
    else:
        orders = KitchenOrder.objects.all().order_by('-created_at')

    data = []
    for order in orders:
        data.append({
            "kitchen_order_id": order.id,
            "order_id": order.order_id,
            "student_id": order.student_id,
            "item_name": order.item_name,
            "quantity": order.quantity,
            "status": order.status,
            "created_at": order.created_at,
            "updated_at": order.updated_at
        })

    return Response(data)


# ─────────────────────────────────────────
# MARK ORDER READY MANUALLY
# admins only — kitchen staff marks ready
# ─────────────────────────────────────────
@api_view(['PATCH'])
@permission_classes([IsAdminUser])
def mark_order_ready(request, order_id):
    """
    PATCH /kitchen/orders/{order_id}/ready/
    Kitchen staff manually marks an order as ready
    """
    try:
        kitchen_order = KitchenOrder.objects.get(order_id=order_id)

        if kitchen_order.status == 'ready':
            return Response(
                {"error": "Order is already marked as ready"},
                status=status.HTTP_400_BAD_REQUEST
            )

        if kitchen_order.status == 'cancelled':
            return Response(
                {"error": "Cannot mark a cancelled order as ready"},
                status=status.HTTP_400_BAD_REQUEST
            )

        kitchen_order.status = 'ready'
        kitchen_order.save()

        auth_header = request.headers.get('Authorization', '')
        token = auth_header.replace('Bearer ', '')
        update_order_gateway_status(order_id, 'ready', token)

        return Response({
            "success": True,
            "order_id": order_id,
            "status": "ready",
            "message": f"Order {order_id} marked as ready. Student has been notified."
        })

    except KitchenOrder.DoesNotExist:
        return Response(
            {"error": "Kitchen order not found"},
            status=status.HTTP_404_NOT_FOUND
        )


# ─────────────────────────────────────────
# CANCEL KITCHEN ORDER
# admins only
# ─────────────────────────────────────────
@api_view(['PATCH'])
@permission_classes([IsAdminUser])
def cancel_kitchen_order(request, order_id):
    """
    PATCH /kitchen/orders/{order_id}/cancel/
    Cancels a kitchen order.
    """
    try:
        kitchen_order = KitchenOrder.objects.get(order_id=order_id)

        non_cancellable = ['ready', 'cancelled']
        if kitchen_order.status in non_cancellable:
            return Response(
                {"error": f"Cannot cancel order with status '{kitchen_order.status}'"},
                status=status.HTTP_400_BAD_REQUEST
            )

        kitchen_order.status = 'cancelled'
        kitchen_order.save()

        return Response({
            "success": True,
            "order_id": order_id,
            "status": "cancelled",
            "message": f"Kitchen order {order_id} cancelled successfully"
        })

    except KitchenOrder.DoesNotExist:
        return Response(
            {"error": "Kitchen order not found"},
            status=status.HTTP_404_NOT_FOUND
        )


# ─────────────────────────────────────────
# HEALTH CHECK
# public
# ─────────────────────────────────────────
@api_view(['GET'])
@permission_classes([AllowAny])
def health(request):
    """
    GET /health/
    Checks database and Redis are reachable.
    Returns 200 if all good, 503 if anything is down.
    """
    try:
        if redis_client.get('chaos_mode:kitchen') == b'1':
            return Response({"error": "Service in chaos mode"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    except Exception:
        pass
    db_status = "ok"
    redis_status = "ok"

    try:
        KitchenOrder.objects.count()
    except Exception as e:
        db_status = f"error: {str(e)}"

    try:
        redis_client.ping()
    except Exception as e:
        redis_status = f"error: {str(e)}"

    if db_status != "ok" or redis_status != "ok":
        return Response(
            {
                "status": "error",
                "database": db_status,
                "redis": redis_status
            },
            status=status.HTTP_503_SERVICE_UNAVAILABLE
        )

    return Response({
        "status": "ok",
        "database": db_status,
        "redis": redis_status
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
    Returns kitchen stats for the admin dashboard.
    """
    avg_response = 0
    if response_times:
        avg_response = sum(response_times) / len(response_times)

    try:
        total_orders = KitchenOrder.objects.count()
        queued = KitchenOrder.objects.filter(status='queued').count()
        preparing = KitchenOrder.objects.filter(status='preparing').count()
        ready = KitchenOrder.objects.filter(status='ready').count()
        cancelled = KitchenOrder.objects.filter(status='cancelled').count()
        failed = KitchenOrder.objects.filter(status='failed').count()
    except Exception:
        total_orders = queued = preparing = ready = cancelled = failed = 0

    return Response({
        "service": "kitchen-queue",
        "total_orders_processed": total_processed,
        "failed_count": failed_count,
        "avg_response_time_seconds": round(avg_response, 4),
        "orders_by_status": {
            "queued": queued,
            "preparing": preparing,
            "ready": ready,
            "cancelled": cancelled,
            "failed": failed
        },
        "total_in_db": total_orders
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
        current = redis_client.get('chaos_mode:kitchen')
        if current and current == b'1':
            redis_client.delete('chaos_mode:kitchen')
            return Response({"status": "Chaos mode disabled"})
        else:
            redis_client.set('chaos_mode:kitchen', '1', ex=600) # 600 seconds (10 min)
            return Response({"status": "Chaos mode enabled for 10 minutes"})
    except Exception as e:
        return Response({"error": f"Failed to toggle chaos: {e}"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
