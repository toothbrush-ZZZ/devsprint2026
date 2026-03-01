from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='KitchenOrder',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('order_id', models.IntegerField(unique=True)),
                ('student_id', models.CharField(max_length=20)),
                ('item_id', models.IntegerField()),
                ('item_name', models.CharField(default='', max_length=100)),
                ('quantity', models.IntegerField(default=1)),
                ('status', models.CharField(choices=[('queued', 'Queued'), ('preparing', 'Preparing'), ('ready', 'Ready'), ('cancelled', 'Cancelled'), ('failed', 'Failed')], default='queued', max_length=20)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
    ]
