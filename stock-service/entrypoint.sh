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

# Seed default Iftar food items
python manage.py shell -c "
from inventory.models import FoodItem

items = [
    ('Iftar Box',        300, 120.00),
    ('Rice with chicken', 300, 120.00),
    ('Rice with beef',    300, 150.00),
    ('Rice with fish',    300, 130.00),
]

for name, qty, price in items:
    if not FoodItem.objects.filter(name=name).exists():
        FoodItem.objects.create(name=name, quantity=qty, price=price)
        print(f'Created: {name} x{qty}')
    else:
        print(f'Already exists: {name}')
"

echo "Starting Stock Service on port 8002..."
python manage.py runserver 0.0.0.0:8002