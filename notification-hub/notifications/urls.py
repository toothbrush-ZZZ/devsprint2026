from django.urls import path
from . import views

urlpatterns = [
    path('notify/', views.notify),     
    path('health/', views.health),      
    path('metrics/', views.metrics),    
    path('chaos/', views.toggle_chaos, name='chaos_toggle'),    
]