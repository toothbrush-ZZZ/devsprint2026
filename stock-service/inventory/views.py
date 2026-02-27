from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status
from django.db import transaction
from .models import FoodItem
from .permissions import IsAdminUser, IsStudent
import redis
import os
import time

# Connect to Redis cache
redis_client = redis.from_url(os.getenv('REDIS_URL', 'redis://redis:6379'))

# Metrics counters — reset when service restarts
total_orders = 0
failed_orders = 0
response_times = []


def update_redis_cache(item_id, quantity):
    """
    Updates Redis whenever stock changes.
    Order Gateway reads from Redis first
    If Redis is down we skip it
    """
    try:
        redis_client.set(f"stock:{item_id}", quantity)
        print(f"Redis updated: stock:{item_id} = {quantity}")
    except Exception as e:
        print(f"Redis update failed (non critical): {e}")


# ─────────────────────────────────────────
# LIST ALL FOOD ITEMS
# public — anyone can see the menu
# ─────────────────────────────────────────
@api_view(['GET'])
@permission_classes([AllowAny])
def list_items(request):
    """
    GET /items/
    disable order buttons when quantity is 0.
    """
    items = FoodItem.objects.filter(is_available=True)
    data = []
    for item in items:
        data.append({
            "id": item.id,
            "name": item.name,
            "quantity": item.quantity,
            "price": str(item.price),
            "available": item.quantity > 0
            # available=False means order button is disabled on frontend
        })
    return Response(data)


# ─────────────────────────────────────────
# CHECK STOCK FOR ONE ITEM
# public — anyone can check stock levels
# ─────────────────────────────────────────
@api_view(['GET'])
@permission_classes([AllowAny])
def check_stock(request, item_id):
    """
    GET /stock/{item_id}/
    Returns stock level for one specific item.
    Order Gateway calls this as fallback if Redis is down.
    """
    try:
        item = FoodItem.objects.get(id=item_id, is_available=True)
        return Response({
            "item_id": item.id,
            "name": item.name,
            "quantity": item.quantity,
            "available": item.quantity > 0
        })
    except FoodItem.DoesNotExist:
        return Response(
            {"error": "Item not found"},
            status=status.HTTP_404_NOT_FOUND
        )


# ─────────────────────────────────────────
# DECREMENT STOCK
# Must be logged in to order
# ─────────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsStudent])
def decrement_stock(request, item_id):
    """
    POST /stock/{item_id}/decrement/
    Requires valid JWT token.
    Reduces stock by 1 using optimistic locking.
    Called by Order Gateway when student places an order.

    Flow:
    1. Check if quantity > 0 — if not return sold out
    2. Try to update with version check
    3. If version changed — someone else was faster — retry
    4. If success — update Redis — return success
    5. After 3 retries — return try again
    """
    global total_orders, failed_orders, response_times
    start_time = time.time()

    MAX_RETRIES = 3

    for attempt in range(MAX_RETRIES):
        try:
            with transaction.atomic():
                # Lock this row during the transaction
                # Nothing else can modify it until we are done
                item = FoodItem.objects.select_for_update().get(
                    id=item_id,
                    is_available=True
                )

                # Check 1 — is there any stock left?
                if item.quantity <= 0:
                    failed_orders += 1
                    return Response(
                        {"error": "Item is sold out"},
                        status=status.HTTP_409_CONFLICT
                    )

                current_version = item.version

                # Check 2 — optimistic locking
                # Only update if version still matches what we read
                # If another request changed the version first
                # updated_rows will be 0 and we retry
                updated_rows = FoodItem.objects.filter(
                    id=item_id,
                    version=current_version
                ).update(
                    quantity=item.quantity - 1,
                    version=current_version + 1
                )

                if updated_rows == 0:
                    # Version mismatch — another request was faster
                    # This is NOT sold out — just retry with fresh data
                    print(f"Version conflict on attempt {attempt + 1}, retrying...")
                    continue

                # Success — update Redis cache with new quantity
                update_redis_cache(item_id, item.quantity - 1)

                # Record response time for metrics
                elapsed = time.time() - start_time
                response_times.append(elapsed)
                if len(response_times) > 100:
                    # Keep only last 100 response times
                    response_times.pop(0)

                total_orders += 1

                return Response({
                    "success": True,
                    "item_id": item_id,
                    "item_name": item.name,
                    "remaining_quantity": item.quantity - 1,
                    "message": "Stock decremented successfully"
                })

        except FoodItem.DoesNotExist:
            failed_orders += 1
            return Response(
                {"error": "Item not found"},
                status=status.HTTP_404_NOT_FOUND
            )

    # All 3 retries failed due to high demand
    failed_orders += 1
    return Response(
        {"error": "High demand! Please try again in a moment"},
        status=status.HTTP_409_CONFLICT
    )


# ─────────────────────────────────────────
# RESTORE STOCK
# system use only — admins only
# NOT for manually adding stock
# Only for automatic recovery after partial failures
# ─────────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsAdminUser])
def restore_stock(request, item_id):
    """
    POST /stock/{item_id}/restore/
    Requires admin JWT token.
    Adds 1 back to stock after a partial failure.

    Partial failure example:
    1. Order Gateway calls Stock Service — stock decremented
    2. Order Gateway calls Kitchen Queue — CRASHES
    3. Stock is gone but no order reached kitchen
    4. Order Gateway calls this to put the stock back
    """
    try:
        with transaction.atomic():
            item = FoodItem.objects.select_for_update().get(
                id=item_id,
                is_available=True
            )
            item.quantity += 1
            item.version += 1
            item.save()

            update_redis_cache(item_id, item.quantity)

            return Response({
                "success": True,
                "item_id": item_id,
                "item_name": item.name,
                "restored_quantity": item.quantity,
                "message": "Stock restored successfully"
            })
    except FoodItem.DoesNotExist:
        return Response(
            {"error": "Item not found"},
            status=status.HTTP_404_NOT_FOUND
        )


# ─────────────────────────────────────────
# ADD STOCK
# admins only — manually add more portions
# ─────────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsAdminUser])
def add_stock(request, item_id):
    """
    POST /stock/{item_id}/add/
    Requires admin JWT token.
    Admins use this to add more portions to an item.
    e.g. "we made 50 more Iftar boxes"
    Body: { "quantity": 50 }
    """
    quantity_to_add = request.data.get('quantity', 0)

    # Validate — must be a positive integer
    if not isinstance(quantity_to_add, int) or quantity_to_add <= 0:
        return Response(
            {"error": "quantity must be a positive integer"},
            status=status.HTTP_400_BAD_REQUEST
        )

    try:
        with transaction.atomic():
            item = FoodItem.objects.select_for_update().get(
                id=item_id,
                is_available=True
            )
            item.quantity += quantity_to_add
            item.version += 1
            item.save()

            # Update Redis so cache reflects new quantity immediately
            update_redis_cache(item_id, item.quantity)

            return Response({
                "success": True,
                "item_id": item_id,
                "item_name": item.name,
                "added": quantity_to_add,
                "new_quantity": item.quantity,
                "message": f"Added {quantity_to_add} portions successfully"
            })
    except FoodItem.DoesNotExist:
        return Response(
            {"error": "Item not found"},
            status=status.HTTP_404_NOT_FOUND
        )


# ─────────────────────────────────────────
# HEALTH CHECK
# public — judges and admin dashboard use this
# ─────────────────────────────────────────
@api_view(['GET'])
@permission_classes([AllowAny])
def health(request):
    """
    GET /health/
    Checks both database and Redis are reachable.
    Returns 200 if all good.
    Returns 503 if anything is down.
    """
    db_status = "ok"
    redis_status = "ok"

    # Check database
    try:
        FoodItem.objects.count()
    except Exception as e:
        db_status = f"error: {str(e)}"

    # Check Redis
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
# public — admin dashboard reads this
# ─────────────────────────────────────────
@api_view(['GET'])
@permission_classes([AllowAny])
def metrics(request):
    """
    GET /metrics/
    Returns service stats for the admin dashboard.
    Shows order counts, failure counts, response times.
    """
    avg_response = 0
    if response_times:
        avg_response = sum(response_times) / len(response_times)

    try:
        total_items = FoodItem.objects.filter(is_available=True).count()
        # quantity__gt=0 means quantity greater than 0
        items_in_stock = FoodItem.objects.filter(
            is_available=True,
            quantity__gt=0
        ).count()
    except:
        total_items = 0
        items_in_stock = 0

    return Response({
        "service": "stock-service",
        "total_orders_processed": total_orders,
        "failed_orders": failed_orders,
        "avg_response_time_seconds": round(avg_response, 4),
        "total_items": total_items,
        "items_in_stock": items_in_stock
    })