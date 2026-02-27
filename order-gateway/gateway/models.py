from django.db import models


class Order(models.Model):

    STATUS_CHOICES = [
        ('pending',         'Pending'),
        ('stock_verified',  'Stock Verified'),
        ('in_kitchen',      'In Kitchen'),
        ('ready',           'Ready'),
        ('cancelled',       'Cancelled'),  
        ('failed',          'Failed'),
    ]

    student_id = models.CharField(max_length=20)

    item_id = models.IntegerField()

    item_name = models.CharField(max_length=100, default='')

    quantity = models.IntegerField(default=1)

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='pending'
    )

    idempotency_key = models.CharField(
        max_length=100,
        unique=True,
        null=True,
        blank=True
    )
    # Unique key per order request
    # Prevents duplicate orders if student clicks twice

    created_at = models.DateTimeField(auto_now_add=True)

    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Order {self.id} — {self.student_id} — {self.status}"