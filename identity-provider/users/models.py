from django.contrib.auth.models import AbstractUser
from django.db import models

class Student(AbstractUser):
   
    student_id = models.CharField(max_length=10, unique=True, blank=True, default='')
    is_admin_user = models.BooleanField(default=False)

    def __str__(self):
        return self.student_id