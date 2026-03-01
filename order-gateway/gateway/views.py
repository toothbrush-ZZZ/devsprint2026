from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status
from django.conf import settings
from .models import Order
from .permissions import IsStudent, IsAdminUser
import requests
import redis
import time
import uuid

# Connect to Redis cache
redis_client = redis.from_url(settings.REDIS_URL)

# Metrics counters
total_orders = 0
failed_orders = 0
response_times = []


def get_stock_from_cache(item_id):
    """
    Check Redis cache for stock level first.
    Returns quantity as integer or None if not in cache.
    Avoids hitting the Stock Service database for every request.
    """
    try:
        value = redis_client.get(f"stock:{item_id}")
        if value is not None:
            return int(value)
        return None
    except Exception as e:
        print(f"Redis cache check failed: {e}")
        return None


def get_stock_from_service(item_id, token):
    """
    Fallback — if Redis is down or item not in cache,
    call the Stock Service directly to get stock level.
    """
    try:
        response = requests.get(
            f"{settings.STOCK_SERVICE_URL}/stock/{item_id}/",
            headers={"Authorization": f"Bearer {token}"},
            timeout=5
        )
        if response.status_code == 200:
            return response.json().get('quantity')
        return None
    except Exception as e:
        print(f"Stock service check failed: {e}")
        return None


def notify_status(order_id, student_id, status_update, item_name=""):
  
    try:
        requests.post(
            f"{settings.NOTIFICATION_HUB_URL}/notify/",
            json={
                "order_id": order_id,
                "student_id": student_id,
                "status": status_update,
                "item_name": item_name
            },
            timeout=3
        )
    except Exception as e:
        # The order still goes through even if notifications are down
        print(f"Notification failed (non critical): {e}")


# ─────────────────────────────────────────
# PLACE ORDER
# students only — must be logged in
# ─────────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsStudent])
def place_order(request):
    """
    POST /order/
    Requires valid JWT token.
    Body: { "item_id": 1 }

    Full flow:
    1. Validate token (JWT middleware handles this automatically)
    2. Check Redis cache for stock — if 0 reject immediately
    3. Call Stock Service to decrement stock
    4. Save order to database with status=pending
    5. Call Kitchen Queue to process the order
    6. Push status updates to student via Notification Hub
    7. Return success response in under 2 seconds
    """
    global total_orders, failed_orders, response_times
    start_time = time.time()

    # Get order details from request body
    item_id = request.data.get('item_id')
    quantity = 1  # Always 1 — each order is for a single item

    # Get student info from the JWT token
    # request.auth is the decoded token
    student_id = request.auth.get('student_id')

    # Validate inputs
    if not item_id:
        return Response(
            {"error": "item_id is required"},
            status=status.HTTP_400_BAD_REQUEST
        )

    # CHECK — ONE ACTIVE ORDER PER STUDENT
    active_order = Order.objects.filter(
        student_id=student_id,
        status__in=['pending', 'stock_verified', 'in_kitchen']
    ).first()

    if active_order:
        return Response(
            {
                "error": "You already have an active order being processed.",
                "existing_order_id": active_order.id,
                "existing_order_status": active_order.status,
                "item_name": active_order.item_name
            },
            status=status.HTTP_409_CONFLICT
        )


    # STEP 1 — HIGH SPEED CACHE STOCK CHECK (redis)
    cached_quantity = get_stock_from_cache(item_id)

    if cached_quantity is not None:
        
        if cached_quantity <= 0:
            failed_orders += 1
            return Response(
                {"error": "Item is sold out (cache check)"},
                status=status.HTTP_409_CONFLICT
            )
    else:
        # Redis miss — check Stock Service directly
        actual_quantity = get_stock_from_service(
            item_id,
            request.headers.get('Authorization', '').replace('Bearer ', '')
        )
        if actual_quantity is not None and actual_quantity <= 0:
            failed_orders += 1
            return Response(
                {"error": "Item is sold out"},
                status=status.HTTP_409_CONFLICT
            )

    
    # STEP 2 — IDEMPOTENCY CHECK
    # Generate a unique key for this order
    idempotency_key = request.data.get(
        'idempotency_key',
        str(uuid.uuid4())
    )

    # Check if this exact order was already processed
    existing_order = Order.objects.filter(
        idempotency_key=idempotency_key
    ).first()

    if existing_order:
        # Return the existing order instead of creating a duplicate
        return Response({
            "success": True,
            "order_id": existing_order.id,
            "status": existing_order.status,
            "message": "Order already processed",
            "duplicate": True
        })

    
    # STEP 3 — CREATE ORDER IN DATABASE
    # Save with status=pending first
    order = Order.objects.create(
        student_id=student_id,
        item_id=item_id,
        quantity=quantity,
        status='pending',
        idempotency_key=idempotency_key
    )

    notify_status(order.id, student_id, 'pending', order.item_name)

    
    # STEP 4 — DECREMENT STOCK
    try:
        stock_response = requests.post(
            f"{settings.STOCK_SERVICE_URL}/stock/{item_id}/decrement/",
            headers={"Authorization": request.headers.get('Authorization')},
            timeout=5
        )

        if stock_response.status_code != 200:
            # Stock decrement failed — update order status and return error
            order.status = 'failed'
            order.save()
            failed_orders += 1
            return Response(
                stock_response.json(),
                status=stock_response.status_code
            )

        # Stock successfully decremented
        stock_data = stock_response.json()
        order.item_name = stock_data.get('item_name', '')
        order.status = 'stock_verified'
        order.save()

        notify_status(order.id, student_id, 'stock_verified', order.item_name)

    except requests.exceptions.Timeout:
        # Stock Service took too long
        order.status = 'failed'
        order.save()
        failed_orders += 1
        return Response(
            {"error": "Stock service timeout, please try again"},
            status=status.HTTP_503_SERVICE_UNAVAILABLE
        )
    except Exception as e:
        # Stock Service crashed
        order.status = 'failed'
        order.save()
        failed_orders += 1
        return Response(
            {"error": f"Stock service error: {str(e)}"},
            status=status.HTTP_503_SERVICE_UNAVAILABLE
        )

    
    # STEP 5 — SEND TO KITCHEN QUEUE
    # acknowledges and processes in background
    try:
        kitchen_response = requests.post(
            f"{settings.KITCHEN_QUEUE_URL}/kitchen/orders/",
            json={
                "order_id": order.id,
                "student_id": student_id,
                "item_id": item_id,
                "item_name": order.item_name,
                "quantity": quantity
            },
            headers={"Authorization": request.headers.get('Authorization')},
            timeout=5
        )

        if kitchen_response.status_code in [200, 201]:
            order.status = 'in_kitchen'
            order.save()
            notify_status(order.id, student_id, 'in_kitchen', order.item_name)
        else:
            # Kitchen failed — restore stock to prevent loss
            try:
                requests.post(
                    f"{settings.STOCK_SERVICE_URL}/stock/{item_id}/restore/",
                    headers={"Authorization": request.headers.get('Authorization')},
                    timeout=5
                )
            except Exception:
                pass
            order.status = 'failed'
            order.save()
            failed_orders += 1
            return Response(
                {"error": "Kitchen service error, stock restored"},
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )

    except Exception as e:
        # Kitchen crashed — restore stock
        try:
            requests.post(
                f"{settings.STOCK_SERVICE_URL}/stock/{item_id}/restore/",
                headers={"Authorization": request.headers.get('Authorization')},
                timeout=5
            )
        except Exception:
            pass
        order.status = 'failed'
        order.save()
        failed_orders += 1
        return Response(
            {"error": "Kitchen service unavailable, stock restored"},
            status=status.HTTP_503_SERVICE_UNAVAILABLE
        )

    elapsed = time.time() - start_time
    response_times.append(elapsed)
    if len(response_times) > 100:
        response_times.pop(0)

    total_orders += 1


    return Response({
        "success": True,
        "order_id": order.id,
        "student_id": student_id,
        "item_id": item_id,
        "item_name": order.item_name,
        "quantity": quantity,
        "status": "in_kitchen",
        "message": "Order placed successfully! Your food is being prepared.",
        "response_time_seconds": round(elapsed, 3)
    }, status=status.HTTP_201_CREATED)


# ─────────────────────────────────────────
# GET ORDER STATUS
# students can check just their own order
# ─────────────────────────────────────────
@api_view(['GET'])
@permission_classes([IsStudent])
def get_order_status(request, order_id):
    """
    GET /order/{order_id}/
    Returns current status of an order.
    Frontend uses this as fallback if WebSocket disconnects.
    """
    try:
        order = Order.objects.get(id=order_id)

        student_id = request.auth.get('student_id')
        if order.student_id != student_id and not request.auth.get('is_admin'):
            return Response(
                {"error": "You can only view your own orders"},
                status=status.HTTP_403_FORBIDDEN
            )

        return Response({
            "order_id": order.id,
            "student_id": order.student_id,
            "item_id": order.item_id,
            "item_name": order.item_name,
            "quantity": order.quantity,
            "status": order.status,
            "created_at": order.created_at,
            "updated_at": order.updated_at
        })
    except Order.DoesNotExist:
        return Response(
            {"error": "Order not found"},
            status=status.HTTP_404_NOT_FOUND
        )


# ─────────────────────────────────────────
# GET ALL ORDERS
# admins only
# ─────────────────────────────────────────
@api_view(['GET'])
@permission_classes([IsAdminUser])
def get_all_orders(request):
    """
    GET /orders/
    Admins can see all orders.
    Used by kitchen staff and admin dashboard.
    """
    orders = Order.objects.all().order_by('-created_at')
    data = []
    for order in orders:
        data.append({
            "order_id": order.id,
            "student_id": order.student_id,
            "item_id": order.item_id,
            "item_name": order.item_name,
            "quantity": order.quantity,
            "status": order.status,
            "created_at": order.created_at,
            "updated_at": order.updated_at
        })
    return Response(data)


# ─────────────────────────────────────────
# UPDATE ORDER STATUS
# used by Kitchen Queue to update order status
# ─────────────────────────────────────────
@api_view(['PATCH'])
@permission_classes([AllowAny])
def update_order_status(request, order_id):
    """
    PATCH /order/{order_id}/status/
    Kitchen staff uses this to mark an order as ready.
    """
    new_status = request.data.get('status')

    valid_statuses = ['pending', 'stock_verified', 'in_kitchen', 'ready', 'cancelled', 'failed']
    if new_status not in valid_statuses:
        return Response(
            {"error": f"Invalid status. Must be one of: {valid_statuses}"},
            status=status.HTTP_400_BAD_REQUEST
        )

    try:
        order = Order.objects.get(id=order_id)
        order.status = new_status
        order.save()

        notify_status(order.id, order.student_id, new_status, order.item_name)

        return Response({
            "success": True,
            "order_id": order.id,
            "new_status": new_status,
            "message": f"Order status updated to {new_status}"
        })
    except Order.DoesNotExist:
        return Response(
            {"error": "Order not found"},
            status=status.HTTP_404_NOT_FOUND
        )


# ─────────────────────────────────────────
# CANCEL ORDER
# admins only
# ─────────────────────────────────────────
@api_view(['DELETE'])
@permission_classes([IsAdminUser])
def cancel_order(request, order_id):
    """
    DELETE /order/{order_id}/cancel/
    Admins only — cancels an accepted order.

    Rules:
    - Cannot cancel an order that is already Ready
    - Cannot cancel an order that is already Failed
    - Cannot cancel an order that is already Cancelled
    - Restores stock back to Stock Service
    """
    try:
        order = Order.objects.get(id=order_id)
    except Order.DoesNotExist:
        return Response(
            {"error": "Order not found"},
            status=status.HTTP_404_NOT_FOUND
        )

    # Check if order can be cancelled
    non_cancellable = ['ready', 'cancelled', 'failed']
    if order.status in non_cancellable:
        return Response(
            {
                "error": f"Cannot cancel order with status '{order.status}'. Only pending, stock_verified, and in_kitchen orders can be cancelled."
            },
            status=status.HTTP_400_BAD_REQUEST
        )

    # Restore stock back to Stock Service
    try:
        restore_response = requests.post(
            f"{settings.STOCK_SERVICE_URL}/stock/{order.item_id}/restore/",
            headers={"Authorization": request.headers.get('Authorization')},
            timeout=5
        )
        if restore_response.status_code != 200:
            print(f"Stock restore warning: {restore_response.json()}")
    except Exception as e:
        print(f"Stock restore failed during cancellation: {e}")
    # Tell Kitchen Queue to cancel this order
    # So kitchen staff know to stop preparing it
    try:
        requests.patch(
            f"{settings.KITCHEN_QUEUE_URL}/kitchen/orders/{order_id}/cancel/",
            headers={"Authorization": request.headers.get('Authorization')},
            timeout=5
        )
        print(f"Kitchen order {order_id} cancelled successfully")
    except Exception as e:
        # Don't stop cancellation if kitchen notification fails
        print(f"Kitchen cancel notification failed: {e}")


    # Update order status to cancelled
    old_status = order.status
    order.status = 'cancelled'
    order.save()

    notify_status(order.id, order.student_id, 'cancelled', order.item_name)

    return Response({
        "success": True,
        "order_id": order.id,
        "student_id": order.student_id,
        "item_name": order.item_name,
        "quantity": order.quantity,
        "previous_status": old_status,
        "new_status": "cancelled",
        "message": f"Order {order_id} cancelled successfully. Stock restored."
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
    Checks database, Redis, and all downstream services.
    Returns 200 if all good, 503 if anything is down.
    """
    try:
        if redis_client.get('chaos_mode') == b'1':
            return Response({"error": "Service in chaos mode"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    except Exception:
        pass
    db_status = "ok"
    redis_status = "ok"
    stock_status = "ok"
    kitchen_status = "ok"
    notification_status = "ok"

    # Check database
    try:
        Order.objects.count()
    except Exception as e:
        db_status = f"error: {str(e)}"

    # Check Redis
    try:
        redis_client.ping()
    except Exception as e:
        redis_status = f"error: {str(e)}"

    # Check Stock Service
    try:
        r = requests.get(
            f"{settings.STOCK_SERVICE_URL}/health/",
            timeout=3
        )
        if r.status_code != 200:
            stock_status = "error"
    except Exception as e:
        stock_status = f"error: {str(e)}"

    # Check Kitchen Queue
    try:
        r = requests.get(
            f"{settings.KITCHEN_QUEUE_URL}/health/",
            timeout=3
        )
        if r.status_code != 200:
            kitchen_status = "error"
    except Exception as e:
        kitchen_status = f"error: {str(e)}"

    # Check Notification Hub
    try:
        r = requests.get(
            f"{settings.NOTIFICATION_HUB_URL}/health/",
            timeout=3
        )
        if r.status_code != 200:
            notification_status = "error"
    except Exception as e:
        notification_status = f"error: {str(e)}"

    all_ok = all(s == "ok" for s in [
        db_status, redis_status, stock_status,
        kitchen_status, notification_status
    ])

    response_data = {
        "status": "ok" if all_ok else "degraded",
        "database": db_status,
        "redis": redis_status,
        "stock_service": stock_status,
        "kitchen_queue": kitchen_status,
        "notification_hub": notification_status
    }

    return Response(
        response_data,
        status=status.HTTP_200_OK if all_ok else status.HTTP_503_SERVICE_UNAVAILABLE
    )


# ─────────────────────────────────────────
# METRICS
# public
# ─────────────────────────────────────────
@api_view(['GET'])
@permission_classes([AllowAny])
def metrics(request):
    """
    GET /metrics/
    Returns gateway stats for the admin dashboard.
    """
    avg_response = 0
    if response_times:
        avg_response = sum(response_times) / len(response_times)

    try:
        total_db_orders = Order.objects.count()
        pending = Order.objects.filter(status='pending').count()
        in_kitchen = Order.objects.filter(status='in_kitchen').count()
        ready = Order.objects.filter(status='ready').count()
        failed = Order.objects.filter(status='failed').count()
    except Exception:
        total_db_orders = 0
        pending = in_kitchen = ready = failed = 0

    return Response({
        "service": "order-gateway",
        "total_orders": total_db_orders,
        "orders_by_status": {
            "pending": pending,
            "in_kitchen": in_kitchen,
            "ready": ready,
            "failed": failed
        },
        "failed_orders": failed_orders,
        "avg_response_time_seconds": round(avg_response, 4),
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
        current = redis_client.get('chaos_mode')
        if current and current == b'1':
            redis_client.delete('chaos_mode')
            return Response({"status": "Chaos mode disabled"})
        else:
            redis_client.set('chaos_mode', '1', ex=60) # 60 seconds
            return Response({"status": "Chaos mode enabled for 60s"})
    except Exception as e:
        return Response({"error": f"Failed to toggle chaos: {e}"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)