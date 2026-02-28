FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Notification Hub runs on port 8005
EXPOSE 8005

ENTRYPOINT ["/entrypoint.sh"]