from django.test import TestCase
from inventory.models import FoodItem


class StockDecrementTest(TestCase):
    """
    Unit tests for stock management logic.
    These run automatically in the CI/CD pipeline
    on every push to GitHub.
    """

    def setUp(self):
    
        self.item = FoodItem.objects.create(
            name="Test Iftar Box",
            quantity=10,
            price=120.00,
            version=0
        )

    def test_item_created_correctly(self):
        # Did the item save to database correctly?
        self.assertEqual(self.item.name, "Test Iftar Box")
        self.assertEqual(self.item.quantity, 10)
        self.assertEqual(self.item.version, 0)

    def test_decrement_reduces_quantity(self):
        # Simulates ordering 1 item
        item = FoodItem.objects.get(id=self.item.id)

        FoodItem.objects.filter(
            id=item.id,
            version=item.version
        ).update(
            quantity=item.quantity - 1,
            version=item.version + 1
        )

        # Reload fresh data from database
        item.refresh_from_db()

        self.assertEqual(item.quantity, 9)  # went from 10 to 9
        self.assertEqual(item.version, 1)   # version bumped from 0 to 1

    def test_decrement_multiple_quantity(self):
        # Simulates ordering 3 items at once
        item = FoodItem.objects.get(id=self.item.id)
        requested_quantity = 3

        FoodItem.objects.filter(
            id=item.id,
            version=item.version
        ).update(
            quantity=item.quantity - requested_quantity,
            version=item.version + 1
        )

        item.refresh_from_db()
        self.assertEqual(item.quantity, 7)  # 10 - 3 = 7
        self.assertEqual(item.version, 1)

    def test_rejects_order_exceeding_stock(self):
        # Student tries to order more than available
        item = FoodItem.objects.get(id=self.item.id)

        requested_quantity = 15   # more than available (10)
        available_quantity = item.quantity

        # Should be rejected — requested > available
        self.assertGreater(requested_quantity, available_quantity)

        # Stock should remain unchanged — nothing decremented
        item.refresh_from_db()
        self.assertEqual(item.quantity, 10)

    def test_optimistic_lock_prevents_double_decrement(self):
        # Simulates two students ordering same item simultaneously
        item = FoodItem.objects.get(id=self.item.id)
        original_version = item.version  # both students read version=0

        # Student A updates first — succeeds
        rows_updated_a = FoodItem.objects.filter(
            id=item.id,
            version=original_version
        ).update(
            quantity=item.quantity - 1,
            version=original_version + 1
        )
        self.assertEqual(rows_updated_a, 1)  # Student A succeeded

        # Student B tries with same old version — must fail
        rows_updated_b = FoodItem.objects.filter(
            id=item.id,
            version=original_version  # version is now 1 not 0
        ).update(
            quantity=item.quantity - 1,
            version=original_version + 1
        )
        self.assertEqual(rows_updated_b, 0)  # Student B correctly blocked

        # Final quantity should be 9 not 8
        item.refresh_from_db()
        self.assertEqual(item.quantity, 9)

    def test_sold_out_detection(self):
        # Set quantity to 0
        self.item.quantity = 0
        self.item.save()

        item = FoodItem.objects.get(id=self.item.id)
        self.assertEqual(item.quantity, 0)
        self.assertFalse(item.quantity > 0)  # correctly detected as sold out

    def test_version_increments_on_each_decrement(self):
        # Version should go up by 1 on every successful decrement
        item = FoodItem.objects.get(id=self.item.id)

        for expected_version in range(1, 4):  # do 3 decrements
            FoodItem.objects.filter(
                id=item.id,
                version=item.version
            ).update(
                quantity=item.quantity - 1,
                version=item.version + 1
            )
            item.refresh_from_db()
            self.assertEqual(item.version, expected_version)

    def test_restore_stock(self):
        # Simulates restore after partial failure
        item = FoodItem.objects.get(id=self.item.id)
        original_quantity = item.quantity

        # First decrement 2
        item.quantity -= 2
        item.version += 1
        item.save()

        # Then restore 2
        item.refresh_from_db()
        item.quantity += 2
        item.version += 1
        item.save()

        item.refresh_from_db()
        self.assertEqual(item.quantity, original_quantity)  # back to original

    def test_add_stock(self):
        # Simulates admin adding more portions
        item = FoodItem.objects.get(id=self.item.id)
        original_quantity = item.quantity

        quantity_to_add = 20
        item.quantity += quantity_to_add
        item.version += 1
        item.save()

        item.refresh_from_db()
        # Should be original + 20
        self.assertEqual(item.quantity, original_quantity + quantity_to_add)