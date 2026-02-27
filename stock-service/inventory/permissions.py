from rest_framework.permissions import BasePermission


class IsAdminUser(BasePermission):

    def has_permission(self, request, view):
        if not request.auth:
            return False
        return bool(request.auth.get('is_admin', False))


class IsStudent(BasePermission):
   
    def has_permission(self, request, view):
        return bool(request.auth)