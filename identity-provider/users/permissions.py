from rest_framework.permissions import BasePermission

class IsAdminUser(BasePermission):
    """
    Only allows access if the user is an admin.
    Reads is_admin from the JWT token payload.
    """
    def has_permission(self, request, view):
        if not request.auth:
            return False
        return bool(request.auth.get('is_admin', False))
