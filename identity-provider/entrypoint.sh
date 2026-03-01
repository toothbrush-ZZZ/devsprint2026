#!/bin/bash

echo "Waiting for database..."

# Keep trying until the database is ready
while ! python -c "
import psycopg2, os
psycopg2.connect(
    dbname=os.getenv('DB_NAME','cafeteria'),
    user=os.getenv('DB_USER','user'),
    password=os.getenv('DB_PASSWORD','password'),
    host=os.getenv('DB_HOST','db'),
    port=os.getenv('DB_PORT','5432')
)" 2>/dev/null; do
  echo "Database not ready yet, retrying..."
  sleep 2
done

echo "Database is ready!"

# Create all database tables from models
python manage.py makemigrations
python manage.py migrate --run-syncdb

# Create default users
python manage.py shell -c "
from users.models import Student
from django.contrib.auth.hashers import make_password

defaults = [
    ('210041001', 'password123', False),
    ('210041002', 'password123', False),
    ('admin001',  'admin123',    True),
]

for student_id, password, is_admin in defaults:
    if not Student.objects.filter(student_id=student_id).exists():
        Student.objects.create(
            username=student_id,
            student_id=student_id,
            password=make_password(password),
            is_admin_user=is_admin
        )
        print(f'Created: {student_id}')
    else:
        print(f'Already exists: {student_id}')
"

echo "Starting server on port 8001..."
python manage.py runserver 0.0.0.0:8001