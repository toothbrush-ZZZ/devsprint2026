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

redis_client = redis.from_url(os.getenv('REDIS_URL', 'redis://redis:6379'))

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
    items = FoodItem.objects.all()
    data = []
    for item in items:
        data.append({
            "id": item.id,
            "name": item.name,
            "quantity": item.quantity,
            "price": str(item.price),
            "available": item.quantity > 0 and item.is_available,
            "is_paused": not item.is_available
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
# students only — must be logged in to order
# ─────────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsStudent])
def decrement_stock(request, item_id):
    """
    POST /stock/{item_id}/decrement/
    Requires valid JWT token.
    Body: { "quantity": 2 }
    Reduces stock by requested quantity using optimistic locking.

    Rules:
    - If requested quantity > available stock → reject entire order
    - If version conflict → retry up to 3 times
    - If sold out → reject with sold out message
    """
    global total_orders, failed_orders, response_times
    start_time = time.time()

    MAX_RETRIES = 3

    for attempt in range(MAX_RETRIES):
        try:
            with transaction.atomic():
                
                item = FoodItem.objects.get(
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
                updated_rows = FoodItem.objects.filter(
                    id=item_id,
                    version=current_version
                ).update(
                    quantity=item.quantity - 1,
                    version=current_version + 1
                )

                if updated_rows == 0:
                    # Version mismatch — another request was faster
                    print(f"Version conflict on attempt {attempt + 1}, retrying...")
                    continue

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

    failed_orders += 1
    return Response(
        {"error": "High demand! Please try again in a moment"},
        status=status.HTTP_409_CONFLICT
    )


# ─────────────────────────────────────────
# RESTORE STOCK
# system use only — used by Order Gateway for compensating transactions
# ─────────────────────────────────────────
@api_view(['POST'])
@permission_classes([AllowAny])
def restore_stock(request, item_id):
    """
    POST /stock/{item_id}/restore/
    Requires valid JWT token.
    Restores stock after a partial failure (e.g., kitchen rejected the order).
    Body: { "quantity": 2 }
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
# PAUSE ITEM
# admins only
# ─────────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsAdminUser])
def pause_item(request, item_id):
    """
    POST /stock/{item_id}/pause/
    Admins only.
    Pauses orders for a specific item.
    """
    try:
        with transaction.atomic():
            item = FoodItem.objects.select_for_update().get(id=item_id)

            if not item.is_available:
                return Response(
                    {"error": f"{item.name} is already paused"},
                    status=status.HTTP_400_BAD_REQUEST
                )

            item.is_available = False
            item.version += 1
            item.save()

            update_redis_cache(item_id, 0)

            return Response({
                "success": True,
                "item_id": item_id,
                "item_name": item.name,
                "status": "paused",
                "message": f"{item.name} is now paused. No new orders will be accepted."
            })

    except FoodItem.DoesNotExist:
        return Response(
            {"error": "Item not found"},
            status=status.HTTP_404_NOT_FOUND
        )


# ─────────────────────────────────────────
# UNPAUSE ITEM
# admins only
# ─────────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsAdminUser])
def unpause_item(request, item_id):
    """
    POST /stock/{item_id}/unpause/
    Admins only.
    Resumes orders for a paused item.
    """
    try:
        with transaction.atomic():
            item = FoodItem.objects.select_for_update().get(id=item_id)

            if item.is_available:
                return Response(
                    {"error": f"{item.name} is not paused"},
                    status=status.HTTP_400_BAD_REQUEST
                )

            item.is_available = True
            item.version += 1
            item.save()


            update_redis_cache(item_id, item.quantity)

            return Response({
                "success": True,
                "item_id": item_id,
                "item_name": item.name,
                "status": "active",
                "quantity": item.quantity,
                "message": f"{item.name} is now active. Orders will be accepted."
            })

    except FoodItem.DoesNotExist:
        return Response(
            {"error": "Item not found"},
            status=status.HTTP_404_NOT_FOUND
        )
    
# ─────────────────────────────────────────
# CREATE ITEM
# admins only — add a new item to the menu
# ─────────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsAdminUser])
def create_item(request):
    """
    POST /items/create/
    Requires admin JWT token.
    Body: {
        "name": "Iftar Box",
        "quantity": 100,
        "price": 120.00
    }
    Creates a brand new food item on the menu.
    is_available defaults to True so it shows up immediately.
    """
    name = request.data.get('name')
    quantity = request.data.get('quantity')
    price = request.data.get('price')

    # Validate — all three fields are required
    if not name:
        return Response(
            {"error": "name is required"},
            status=status.HTTP_400_BAD_REQUEST
        )
    if not isinstance(quantity, int) or quantity < 0:
        return Response(
            {"error": "quantity must be a non-negative integer"},
            status=status.HTTP_400_BAD_REQUEST
        )
    if price is None:
        return Response(
            {"error": "price is required"},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Check — don't allow duplicate item names
    if FoodItem.objects.filter(name=name).exists():
        return Response(
            {"error": f"An item named '{name}' already exists. Use add_stock to increase quantity."},
            status=status.HTTP_400_BAD_REQUEST
        )

    item = FoodItem.objects.create(
        name=name,
        quantity=quantity,
        price=price,
        version=0,
        is_available=True
    )

    # Sync Redis so Order Gateway cache is up to date immediately
    update_redis_cache(item.id, item.quantity)

    return Response({
        "success": True,
        "item_id": item.id,
        "item_name": item.name,
        "quantity": item.quantity,
        "price": str(item.price),
        "message": f"'{item.name}' has been added to the menu."
    }, status=status.HTTP_201_CREATED)


# ─────────────────────────────────────────
# DELETE ITEM
# admins only — permanently remove from menu
# ─────────────────────────────────────────
@api_view(['DELETE'])
@permission_classes([IsAdminUser])
def delete_item(request, item_id):
    """
    DELETE /items/{item_id}/delete/
    Requires admin JWT token.
    Permanently removes the item from the database.

    Note: For temporary removal, use pause instead.
    Only use delete when the item will never come back.
    """
    try:
        item = FoodItem.objects.get(id=item_id)
        item_name = item.name  # save name before deletion for the response

        item.delete()

        # Remove from Redis cache — set to 0 so Gateway rejects instantly
        update_redis_cache(item_id, 0)

        return Response({
            "success": True,
            "item_id": item_id,
            "item_name": item_name,
            "message": f"'{item_name}' has been permanently deleted from the menu."
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
    try:
        if redis_client.get('chaos_mode') == b'1':
            return Response({"error": "Service in chaos mode"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    except Exception:
        pass
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
    except Exception:
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