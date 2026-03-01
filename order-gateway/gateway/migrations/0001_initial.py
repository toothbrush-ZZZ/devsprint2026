from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='Order',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('student_id', models.CharField(max_length=20)),
                ('item_id', models.IntegerField()),
                ('item_name', models.CharField(default='', max_length=100)),
                ('quantity', models.IntegerField(default=1)),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('stock_verified', 'Stock Verified'), ('in_kitchen', 'In Kitchen'), ('ready', 'Ready'), ('cancelled', 'Cancelled'), ('failed', 'Failed')], default='pending', max_length=20)),
                ('idempotency_key', models.CharField(blank=True, max_length=100, null=True, unique=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
    ]
