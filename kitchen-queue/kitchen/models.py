from django.db import models


class KitchenOrder(models.Model):
    STATUS_CHOICES = [
        ('queued',      'Queued'),
        ('preparing',   'Preparing'),
        ('ready',       'Ready'),
        ('cancelled',   'Cancelled'),
        ('failed',      'Failed'),
    ]

    order_id = models.IntegerField(unique=True)
    # The order ID from the Order Gateway
    # Links this kitchen order to the main order

    student_id = models.CharField(max_length=20)

    item_id = models.IntegerField()

    item_name = models.CharField(max_length=100, default='')

    quantity = models.IntegerField(default=1)

    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='queued'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Kitchen Order {self.order_id} — {self.item_name} — {self.status}"