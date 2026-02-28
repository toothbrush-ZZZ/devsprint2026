import json
from channels.generic.websocket import AsyncWebsocketConsumer


class StudentNotificationConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for student order status updates.

    Each student connects to their own channel:
    ws://notification-hub:8005/ws/student/{student_id}/

    When Order Gateway calls /notify/ with a student_id,
    we look up that student's channel and push the update.
    Student sees their order status change instantly.
    """

    async def connect(self):
        """
        Called when student opens a WebSocket connection.
        ws://notification-hub:8005/ws/student/210041001/
        """
        # Get student_id from the URL
        self.student_id = self.scope['url_route']['kwargs']['student_id']

        # Create a unique channel group name for this student
        # e.g. "student_210041001"
        self.group_name = f"student_{self.student_id}"

        await self.channel_layer.group_add(
            self.group_name,
            self.channel_name
        )

        await self.accept()

        
        await self.send(text_data=json.dumps({
            "type": "connected",
            "message": f"Connected to notification service",
            "student_id": self.student_id
        }))

        print(f"Student {self.student_id} connected to notifications")

    async def disconnect(self, close_code):
        """
        Called when student closes the WebSocket connection.
        e.g. closes browser tab or loses internet
        """
        await self.channel_layer.group_discard(
            self.group_name,
            self.channel_name
        )
        print(f"Student {self.student_id} disconnected from notifications")

    async def receive(self, text_data):
        pass

    async def order_update(self, event):
        # Send the status update to the student's browser
        await self.send(text_data=json.dumps({
            "type": "order_update",
            "order_id": event["order_id"],
            "status": event["status"],
            "message": event.get("message", "")
        }))


class KitchenNotificationConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for kitchen staff notifications.

    All kitchen staff connect to one shared channel:
    ws://notification-hub:8005/ws/kitchen/

    Receives:
    - New orders arriving
    - Order cancellations
    - Any kitchen relevant updates
    """

    async def connect(self):
        """
        Called when kitchen staff opens WebSocket connection.
        All kitchen staff share one group called "kitchen_staff"
        so they all see the same notifications.
        """
        self.group_name = "kitchen_staff"

        await self.channel_layer.group_add(
            self.group_name,
            self.channel_name
        )

        await self.accept()

        await self.send(text_data=json.dumps({
            "type": "connected",
            "message": "Connected to kitchen notification service"
        }))

        print("Kitchen staff connected to notifications")

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            self.group_name,
            self.channel_name
        )
        print("Kitchen staff disconnected from notifications")

    async def receive(self, text_data):
        pass

    async def kitchen_update(self, event):
        """
        Called when a new order or cancellation notification
        is sent to the kitchen_staff group.
        Pushes update to all connected kitchen staff screens.
        """
        await self.send(text_data=json.dumps({
            "type": "kitchen_update",
            "order_id": event["order_id"],
            "event_type": event["event_type"],
            "item_name": event.get("item_name", ""),
            "quantity": event.get("quantity", 1),
            "student_id": event.get("student_id", ""),
            "message": event.get("message", "")
        }))