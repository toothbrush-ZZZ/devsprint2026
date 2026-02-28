from django.urls import path
from . import views

urlpatterns = [
    path('items/', views.list_items),
    path('stock/<int:item_id>/', views.check_stock),
    path('stock/<int:item_id>/decrement/', views.decrement_stock),
    path('stock/<int:item_id>/restore/', views.restore_stock),
    path('stock/<int:item_id>/add/', views.add_stock),
    path('stock/<int:item_id>/pause/', views.pause_item),
    path('stock/<int:item_id>/unpause/', views.unpause_item),
    path('health/', views.health),
    path('metrics/', views.metrics),
]