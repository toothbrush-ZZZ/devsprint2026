from django.db import models

class FoodItem(models.Model):
   

    name = models.CharField(max_length=100)

    quantity = models.IntegerField(default=0)

    price = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    # Price in BDT

    version = models.IntegerField(default=0)
    # Increments by 1 every time stock changes
    # Prevents two students grabbing the last item simultaneously

    is_available = models.BooleanField(default=True)
    # Set to False to remove item from menu without deleting it

    def __str__(self):
        return f"{self.name} (qty: {self.quantity})"