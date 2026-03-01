from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed

class MicroserviceJWTAuthentication(JWTAuthentication):
    """
    Stateless JWT Authentication for Microservices.
    """

    def get_user(self, validated_token):
        """
        Overrides the default get_user method.
        """
        try:
            student_id = validated_token.get('student_id')
            is_admin = validated_token.get('is_admin', False)

            if not student_id:
                raise AuthenticationFailed('Token contained no recognizable user identification')

            return {
                'student_id': student_id,
                'is_admin': is_admin,
                'is_authenticated': True
            }
        except Exception as e:
            raise AuthenticationFailed(f"User resolution failed: {str(e)}")
