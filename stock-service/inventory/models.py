from django.db import models

class FoodItem(models.Model):
   

    name = models.CharField(max_length=100)

    quantity = models.IntegerField(default=1)

    price = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    # Price in BDT

    version = models.IntegerField(default=0)

    is_available = models.BooleanField(default=True)
    # Set to False to remove item from menu without deleting it

    def __str__(self):
        return f"{self.name} (qty: {self.quantity})"