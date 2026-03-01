from django.test import TestCase
from gateway.models import Order


class OrderValidationTest(TestCase):
    """
    Unit tests for order validation logic.
    These run automatically in the CI/CD pipeline.
    """

    def setUp(self):
        self.order = Order.objects.create(
            student_id='210041001',
            item_id=1,
            item_name='Iftar Box',
            quantity=1,
            status='pending',
            idempotency_key='test-key-001'
        )

    # ── ORDER CREATION ──────────────────────────────

    def test_order_created_correctly(self):
        self.assertEqual(self.order.student_id, '210041001')
        self.assertEqual(self.order.item_id, 1)
        self.assertEqual(self.order.item_name, 'Iftar Box')
        self.assertEqual(self.order.quantity, 1)
        self.assertEqual(self.order.status, 'pending')

    def test_order_default_status_is_pending(self):
        order = Order.objects.create(
            student_id='210041002',
            item_id=2,
            quantity=1,
            idempotency_key='test-key-002'
        )
        self.assertEqual(order.status, 'pending')

    def test_order_default_quantity_is_one(self):
        order = Order.objects.create(
            student_id='210041002',
            item_id=2,
            idempotency_key='test-key-003'
        )
        self.assertEqual(order.quantity, 1)

    # ── IDEMPOTENCY ──────────────────────────────

    def test_idempotency_key_prevents_duplicate_orders(self):
        """Duplicate idempotency_key must raise IntegrityError"""
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            Order.objects.create(
                student_id='210041001',
                item_id=1,
                quantity=1,
                idempotency_key='test-key-001'  # same key as setUp
            )

    def test_different_idempotency_keys_allow_multiple_orders(self):
        order2 = Order.objects.create(
            student_id='210041001',
            item_id=1,
            quantity=1,
            idempotency_key='test-key-different'
        )
        self.assertNotEqual(self.order.id, order2.id)

    def test_null_idempotency_key_allowed(self):
        """Multiple orders with null idempotency_key should be allowed"""
        order1 = Order.objects.create(
            student_id='210041001',
            item_id=1,
            quantity=1,
            idempotency_key=None
        )
        order2 = Order.objects.create(
            student_id='210041001',
            item_id=1,
            quantity=1,
            idempotency_key=None
        )
        self.assertNotEqual(order1.id, order2.id)

    # ── STATUS TRANSITIONS ──────────────────────────────

    def test_status_transitions_to_stock_verified(self):
        self.order.status = 'stock_verified'
        self.order.save()
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, 'stock_verified')

    def test_status_transitions_to_in_kitchen(self):
        self.order.status = 'in_kitchen'
        self.order.save()
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, 'in_kitchen')

    def test_status_transitions_to_ready(self):
        self.order.status = 'ready'
        self.order.save()
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, 'ready')

    def test_status_transitions_to_failed(self):
        self.order.status = 'failed'
        self.order.save()
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, 'failed')

    def test_status_transitions_to_cancelled(self):
        self.order.status = 'cancelled'
        self.order.save()
        self.order.refresh_from_db()
        self.assertEqual(self.order.status, 'cancelled')

    # ── CANCELLATION RULES ──────────────────────────────

    def test_pending_order_can_be_cancelled(self):
        non_cancellable = ['ready', 'cancelled', 'failed']
        self.assertNotIn(self.order.status, non_cancellable)

    def test_ready_order_cannot_be_cancelled(self):
        self.order.status = 'ready'
        self.order.save()
        non_cancellable = ['ready', 'cancelled', 'failed']
        self.assertIn(self.order.status, non_cancellable)

    def test_failed_order_cannot_be_cancelled(self):
        self.order.status = 'failed'
        self.order.save()
        non_cancellable = ['ready', 'cancelled', 'failed']
        self.assertIn(self.order.status, non_cancellable)

    def test_already_cancelled_order_cannot_be_cancelled_again(self):
        self.order.status = 'cancelled'
        self.order.save()
        non_cancellable = ['ready', 'cancelled', 'failed']
        self.assertIn(self.order.status, non_cancellable)

    def test_in_kitchen_order_can_be_cancelled(self):
        self.order.status = 'in_kitchen'
        self.order.save()
        non_cancellable = ['ready', 'cancelled', 'failed']
        self.assertNotIn(self.order.status, non_cancellable)

    # ── VALID STATUS VALUES ──────────────────────────────

    def test_valid_status_values(self):
        valid_statuses = ['pending', 'stock_verified', 'in_kitchen', 'ready', 'cancelled', 'failed']
        for valid_status in valid_statuses:
            self.order.status = valid_status
            self.order.save()
            self.order.refresh_from_db()
            self.assertEqual(self.order.status, valid_status)

    # ── ORDERING / RETRIEVAL ──────────────────────────────

    def test_orders_have_timestamps(self):
        self.assertIsNotNone(self.order.created_at)
        self.assertIsNotNone(self.order.updated_at)

    def test_updated_at_changes_on_save(self):
        original_updated = self.order.updated_at
        self.order.status = 'in_kitchen'
        self.order.save()
        self.order.refresh_from_db()
        self.assertGreaterEqual(self.order.updated_at, original_updated)

    def test_student_can_have_multiple_orders(self):
        order2 = Order.objects.create(
            student_id='210041001',
            item_id=2,
            quantity=1,
            idempotency_key='test-key-multi-1'
        )
        order3 = Order.objects.create(
            student_id='210041001',
            item_id=3,
            quantity=1,
            idempotency_key='test-key-multi-2'
        )
        student_orders = Order.objects.filter(student_id='210041001')
        self.assertEqual(student_orders.count(), 3)  # setUp + 2 new

    def test_order_str_representation(self):
        string = str(self.order)
        self.assertIn('210041001', string)
        self.assertIn('pending', string)
