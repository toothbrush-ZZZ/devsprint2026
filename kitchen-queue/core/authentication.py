from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed

class MicroserviceJWTAuthentication(JWTAuthentication):
    """
    Stateless JWT Authentication for Microservices.
    
    Instead of passing the user_id from the token to the database to fetch
    the User model (which doesn't exist in this microservice's DB), 
    we construct a simple dictionary containing the claims we care about.
    """

    def get_user(self, validated_token):
        """
        Overrides the default get_user method.
        
        Returns a dictionary representing the user instead of a Django User model instance.
        This dictionary will be accessible in views as `request.user` (though we 
        continue using `request.auth` in most microservice views).
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
