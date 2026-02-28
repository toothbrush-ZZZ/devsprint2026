from django.urls import path
from . import views

urlpatterns = [
    path('kitchen/orders/', views.receive_order),                        
    path('kitchen/orders/all/', views.get_kitchen_orders),               
    path('kitchen/orders/<int:order_id>/ready/', views.mark_order_ready),   
    path('kitchen/orders/<int:order_id>/cancel/', views.cancel_kitchen_order),  
    path('health/', views.health),                                       
    path('metrics/', views.metrics),                                     
]