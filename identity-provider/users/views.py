from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status
from rest_framework_simplejwt.tokens import RefreshToken, AccessToken
from rest_framework_simplejwt.exceptions import TokenError
from django.contrib.auth import authenticate
from django.contrib.auth.hashers import check_password
from django.contrib.auth.hashers import make_password
from .models import Student
from .permissions import IsAdminUser
import redis
import os

redis_client = redis.from_url(os.getenv('REDIS_URL', 'redis://redis:6379'))


@api_view(['POST'])
@permission_classes([AllowAny])
def register(request):
    """
    POST /register/
    Body: { "student_id": "210041001", "password": "pass123" }
    Creates a new student account
    """
    student_id = request.data.get('student_id')
    password = request.data.get('password')

    if not student_id or not password:
        return Response(
            {"error": "student_id and password are required"},
            status=status.HTTP_400_BAD_REQUEST
        )

    if Student.objects.filter(student_id=student_id).exists():
        return Response(
            {"error": "Student ID already registered"},
            status=status.HTTP_400_BAD_REQUEST
        )

    Student.objects.create(
        username=student_id,
        student_id=student_id,
        password=make_password(password)
    )

    return Response(
        {"message": f"Student {student_id} registered successfully"},
        status=status.HTTP_201_CREATED
    )


@api_view(['POST'])
@permission_classes([AllowAny])
def login(request):
    """
    POST /login/
    Body: { "student_id": "210041001", "password": "pass123" }
    Returns JWT tokens
    """
    student_id = request.data.get('student_id')
    password = request.data.get('password')

    if not student_id or not password:
        return Response(
            {"error": "student_id and password are required"},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Rate limiting: 3 login attempts per minute per student_id
    try:
        rate_key = f"login_attempts:{student_id}"
        attempts = redis_client.get(rate_key)
        if attempts and int(attempts) >= 3:
            return Response(
                {"error": "Too many login attempts. Please wait 1 minute before trying again."},
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )
        pipe = redis_client.pipeline()
        pipe.incr(rate_key)
        pipe.expire(rate_key, 60)
        pipe.execute()
    except Exception as e:
        # If Redis is down, allow login but log the error
        print(f"Rate limiting unavailable: {e}")

    # Checks username + password
    student = authenticate(username=student_id, password=password)

    if not student:
        return Response(
            {"error": "Invalid student ID or password"},
            status=status.HTTP_401_UNAUTHORIZED
        )

    # Creates JWT tokens
    refresh = RefreshToken.for_user(student)
    access = refresh.access_token

    # Embed extra info into the token
    access['student_id'] = student.student_id
    access['is_admin'] = student.is_admin_user

    return Response({
        "access_token": str(access),
        "refresh_token": str(refresh),
        "student_id": student.student_id,
        "is_admin": student.is_admin_user
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def verify_token(request):
    """
    POST /verify/
    Body: { "token": "eyJ..." }
    Used by other services to validate tokens
    """
    token = request.data.get('token')

    if not token:
        return Response({"error": "token required"}, status=400)

    try:
        decoded = AccessToken(token)
        return Response({
            "valid": True,
            "student_id": decoded.get('student_id'),
            "is_admin": decoded.get('is_admin')
        })
    except TokenError:
        return Response(
            {"valid": False, "error": "Invalid or expired token"},
            status=status.HTTP_401_UNAUTHORIZED
        )


@api_view(['GET'])
@permission_classes([AllowAny])
def health(request):
    """
    GET /health/
    Returns 200 if service and database are working
    Returns 503 if database is down
    """
    try:
        if redis_client.get('chaos_mode') == b'1':
            return Response({"error": "Service in chaos mode"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    except Exception:
        pass
    try:
        Student.objects.count()
        return Response({"status": "ok", "database": "reachable"})
    except Exception as e:
        return Response(
            {"status": "error", "database": "unreachable", "detail": str(e)},
            status=status.HTTP_503_SERVICE_UNAVAILABLE
        )


@api_view(['GET'])
@permission_classes([AllowAny])
def metrics(request):
    """
    GET /metrics/
    Returns basic service metrics for the admin dashboard
    """
    try:
        total_students = Student.objects.count()
    except Exception:
        total_students = 0

    return Response({
        "service": "identity-provider",
        "total_students": total_students,
        "status": "running"
    })

# ─────────────────────────────────────────
# CHANGE PASSWORD
# logged-in users change their own password
# ─────────────────────────────────────────
@api_view(['POST'])
def change_password(request):
    """
    POST /change-password/
    Body: { "old_password": "...", "new_password": "..." }
    Requires valid JWT token.
    """
    old_password = request.data.get('old_password')
    new_password = request.data.get('new_password')

    if not old_password or not new_password:
        return Response(
            {"error": "old_password and new_password are required"},
            status=status.HTTP_400_BAD_REQUEST
        )

    if len(new_password) < 4:
        return Response(
            {"error": "New password must be at least 4 characters"},
            status=status.HTTP_400_BAD_REQUEST
        )

    user = request.user
    if not check_password(old_password, user.password):
        return Response(
            {"error": "Old password is incorrect"},
            status=status.HTTP_400_BAD_REQUEST
        )

    user.set_password(new_password)
    user.save()

    return Response({"message": "Password changed successfully"})


# ─────────────────────────────────────────
# ADMIN RESET PASSWORD
# admins can reset any student's password
# ─────────────────────────────────────────
@api_view(['POST'])
@permission_classes([IsAdminUser])
def admin_reset_password(request):
    """
    POST /reset-password/
    Body: { "student_id": "...", "new_password": "..." }
    Admin only — resets a student's password without knowing the old one.
    """
    student_id = request.data.get('student_id')
    new_password = request.data.get('new_password')

    if not student_id or not new_password:
        return Response(
            {"error": "student_id and new_password are required"},
            status=status.HTTP_400_BAD_REQUEST
        )

    try:
        student = Student.objects.get(student_id=student_id)
    except Student.DoesNotExist:
        return Response(
            {"error": "Student not found"},
            status=status.HTTP_404_NOT_FOUND
        )

    student.set_password(new_password)
    student.save()

    return Response({"message": f"Password for {student_id} has been reset"})


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
            redis_client.set('chaos_mode', '1', ex=600) # 600 seconds (10 min)
            return Response({"status": "Chaos mode enabled for 10 minutes"})
    except Exception as e:
        return Response({"error": f"Failed to toggle chaos: {e}"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)