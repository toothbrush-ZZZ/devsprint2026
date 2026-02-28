from django.test import TestCase
from inventory.models import FoodItem


class StockDecrementTest(TestCase):
    """
    Unit tests for stock management logic.
    These run automatically in the CI/CD pipeline
    on every push to GitHub.
    """

    def setUp(self):
        # Runs before every test method automatically
        # Creates a fresh test item each time
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
        # Simulates what decrement_stock view does
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

    def test_optimistic_lock_prevents_double_decrement(self):
        # Simulates two students ordering the same item simultaneously
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

        # First decrement
        item.quantity -= 1
        item.version += 1
        item.save()

        # Then restore
        item.refresh_from_db()
        item.quantity += 1
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
        self.assertEqual(item.quantity, original_quantity + quantity_to_add)

class MenuManagementTest(TestCase):
    """
    Tests for admin menu management —
    creating, deleting, pausing, unpausing items.
    """

    def setUp(self):
        self.item = FoodItem.objects.create(
            name="Fruit Salad",
            quantity=50,
            price=60.00,
            version=0,
            is_available=True
        )

    # ── CREATE ──────────────────────────────────────

    def test_create_new_item(self):
        new_item = FoodItem.objects.create(
            name="Juice Box",
            quantity=100,
            price=35.00,
            version=0,
            is_available=True
        )
        self.assertEqual(new_item.name, "Juice Box")
        self.assertEqual(new_item.quantity, 100)
        self.assertTrue(new_item.is_available)

    def test_duplicate_item_name_detected(self):
        exists = FoodItem.objects.filter(name="Fruit Salad").exists()
        self.assertTrue(exists)

    # ── DELETE ──────────────────────────────────────

    def test_delete_item_removes_from_database(self):
        item_id = self.item.id
        self.item.delete()

        exists = FoodItem.objects.filter(id=item_id).exists()
        self.assertFalse(exists)

    def test_delete_nonexistent_item_raises_error(self):
        with self.assertRaises(FoodItem.DoesNotExist):
            FoodItem.objects.get(id=99999)

    # ── PAUSE / UNPAUSE ─────────────────────────────

    def test_pause_hides_item_from_menu(self):
        self.item.is_available = False
        self.item.version += 1
        self.item.save()

        self.item.refresh_from_db()
        self.assertFalse(self.item.is_available)

        visible_items = FoodItem.objects.filter(is_available=True)
        self.assertNotIn(self.item, visible_items)

    def test_unpause_restores_item_to_menu(self):
        self.item.is_available = False
        self.item.version += 1
        self.item.save()

        self.item.is_available = True
        self.item.version += 1
        self.item.save()

        self.item.refresh_from_db()
        self.assertTrue(self.item.is_available)

        visible_items = FoodItem.objects.filter(is_available=True)
        self.assertIn(self.item, visible_items)

    def test_paused_item_cannot_be_ordered(self):
        self.item.is_available = False
        self.item.save()

        result = FoodItem.objects.filter(
            id=self.item.id,
            is_available=True
        ).first()

        self.assertIsNone(result)

    # ── LIST ────────────────────────────────────────

    def test_list_only_shows_available_items(self):
        paused = FoodItem.objects.create(
            name="Paused Item",
            quantity=10,
            price=50.00,
            is_available=False
        )

        visible = list(FoodItem.objects.filter(is_available=True))

        self.assertIn(self.item, visible)
        self.assertNotIn(paused, visible)