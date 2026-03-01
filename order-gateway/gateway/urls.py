from django.urls import path
from . import views

urlpatterns = [
    path('order/', views.place_order),
    path('order/<int:order_id>/', views.get_order_status),
    path('order/<int:order_id>/status/', views.update_order_status),
    path('order/<int:order_id>/cancel/', views.cancel_order),
    path('orders/', views.get_all_orders),
    path('health/', views.health),
    path('metrics/', views.metrics),
    path('chaos/', views.toggle_chaos, name='chaos_toggle'),
]