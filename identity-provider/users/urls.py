from django.urls import path
from . import views

urlpatterns = [
    path('register/', views.register),
    path('login/', views.login),
    path('verify/', views.verify_token),
    path('health/', views.health),
    path('metrics/', views.metrics),
    path('chaos/', views.toggle_chaos, name='chaos_toggle'),
]