#!/bin/bash

echo "Waiting for database..."

while ! python -c "
import psycopg2, os
psycopg2.connect(
    dbname=os.getenv('DB_NAME','cafeteria'),
    user=os.getenv('DB_USER','user'),
    password=os.getenv('DB_PASSWORD','password'),
    host=os.getenv('DB_HOST','db'),
    port=os.getenv('DB_PORT','5432')
)" 2>/dev/null; do
  echo "Retrying in 2s..."
  sleep 2
done

echo "Database ready!"

python manage.py makemigrations
python manage.py migrate --run-syncdb

echo "Starting Order Gateway on port 8003..."
python manage.py runserver 0.0.0.0:8003